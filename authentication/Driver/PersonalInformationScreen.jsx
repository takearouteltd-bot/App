import React, { useState, useEffect, useRef } from "react";
import { View, StyleSheet } from "react-native";
import { Alert } from "../../components/ui/alert";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db, auth } from "../../config/firebase";
import { Banner, Field, SPACE } from "../../components/ui/kit";
import { DRIVER_STEPS, OnboardingFrame, StepSection } from "../../components/onboarding/kit";
import SelectField from "../../components/ui/SelectField";
import { useCities } from "../../utils/cities";

// UK National Insurance number: 2 prefix letters + 6 digits + 1 suffix letter.
// Excludes invalid prefixes/letters per HMRC rules.
const NINO_REGEX =
  /^(?!BG|GB|NK|KN|TN|NT|ZZ)[ABCEGHJ-PRSTW-Z][ABCEGHJ-NPRSTW-Z]\d{6}[A-D]$/;

const isValidNino = (value) => NINO_REGEX.test(value.replace(/\s/g, "").toUpperCase());

// Date of birth as DD/MM/YYYY — must be a real past date and 18+.
const isValidDob = (value) => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return false;

  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);

  const date = new Date(year, month - 1, day);
  // Reject impossible dates (e.g. 31/02) that JS would roll over.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return false;
  }

  const today = new Date();
  if (date > today) return false;

  // Must be at least 18 years old.
  const eighteenth = new Date(date.getFullYear() + 18, date.getMonth(), date.getDate());
  if (eighteenth > today) return false;

  // Sanity upper bound.
  if (year < today.getFullYear() - 100) return false;

  return true;
};

export default function PersonalInformationScreen({ navigation, setOnboardingStatus }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("");
  const [nin, setNin] = useState("");
  const [address, setAddress] = useState("");
  // Where they will take jobs. Required once the dashboard lists any cities.
  const cities = useCities();
  const [workingCityId, setWorkingCityId] = useState(null);
  // Declared here, confirmed by an admin against the licence. Only verified
  // female drivers are offered rides where a passenger asked for one.
  const [gender, setGender] = useState(null);
  const [saving, setSaving] = useState(false);
  // Field errors appear only after a first attempt to continue, not while
  // someone is still typing.
  const [tried, setTried] = useState(false);
  const resumed = useRef(false);
  // Whether drivers/{uid} already existed when this step loaded.
  const hasRecord = useRef(false);

  const driverId = auth.currentUser?.uid;

  // Auto-format DOB as DD/MM/YYYY while typing.
  const handleDobChange = (text) => {
    const digits = text.replace(/\D/g, "").slice(0, 8);
    let formatted = digits;
    if (digits.length > 4) {
      formatted = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    } else if (digits.length > 2) {
      formatted = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    }
    setDob(formatted);
  };

  // Force uppercase, strip spaces, cap at 9 chars for the NI number.
  const handleNinChange = (text) => {
    setNin(text.replace(/\s/g, "").toUpperCase().slice(0, 9));
  };

  // Load what they already entered, and pick up where they left off: a driver
  // who reached step 3 last time lands on step 3, with steps 1 and 2 behind
  // them so Back still works.
  useEffect(() => {
    const fetchData = async () => {
      if (!driverId) return;

      try {
        const snap = await getDoc(doc(db, "drivers", driverId));
        if (!snap.exists()) return;
        hasRecord.current = true;

        const data = snap.data();
        setFirstName(data.firstName || "");
        setLastName(data.lastName || "");
        setDob(data.dob || "");
        setNin(data.nin || "");
        setAddress(data.address || "");
        setWorkingCityId(data.workingCityId || null);
        setGender(data.gender || null);

        const reached = Math.min(Number(data.onboardingStep) || 1, DRIVER_STEPS.length);
        if (reached > 1 && !resumed.current) {
          resumed.current = true;
          navigation.reset({
            index: reached - 1,
            routes: DRIVER_STEPS.slice(0, reached).map((s) => ({ name: s.route })),
          });
        }
      } catch (error) {
        console.log("Error fetching driver data:", error);
      }
    };

    fetchData();
  }, [driverId, navigation]);

  const errors = {
    firstName: !firstName.trim() ? "Enter your first name" : null,
    lastName: !lastName.trim() ? "Enter your last name" : null,
    dob: !dob
      ? "Enter your date of birth"
      : !isValidDob(dob)
      ? "Use DD/MM/YYYY. You must be 18 or over."
      : null,
    nin: !nin
      ? "Enter your National Insurance number"
      : !isValidNino(nin)
      ? "That doesn't look right, e.g. AB123456C"
      : null,
    address: !address.trim() ? "Enter your home address" : null,
    gender: !gender ? "Choose an option" : null,
    workingCityId: cities.length && !workingCityId ? "Choose the city you will drive in" : null,
  };
  const show = (key) => (tried ? errors[key] : null);

  const handleContinue = async () => {
    if (!driverId) return;
    setTried(true);

    const firstError = Object.values(errors).find(Boolean);
    if (firstError) {
      Alert.alert("Check your details", firstError);
      return;
    }

    setSaving(true);
    try {
      await setDoc(
        doc(db, "drivers", driverId),
        {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          fullName: `${firstName.trim()} ${lastName.trim()}`,
          dob,
          nin,
          address: address.trim(),
          gender,
          workingCityId: workingCityId || null,
          workingCityName: cities.find((c) => c.id === workingCityId)?.name || null,

          onboardingStep: 2,
          onboardingComplete: false,

          role: "driver",
          approved: false,
          status: "offline",

          // Only set once; every later save keeps the original.
          ...(hasRecord.current ? {} : { createdAt: new Date() }),
          updatedAt: new Date(),
        },
        { merge: true }
      );
      hasRecord.current = true;

      setOnboardingStatus("onboarding");
      navigation.navigate("IdentityVerification");
    } catch (error) {
      console.log("Error saving personal info:", error);
      Alert.alert("Could not save", "Your details were not saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <OnboardingFrame
      step={1}
      title="Tell us about you"
      subtitle="As it appears on your driving licence. It takes about a minute."
      action={{ title: "Continue", onPress: handleContinue, loading: saving, icon: "arrow-forward" }}
    >
      <StepSection title="Your name">
        <View style={styles.row}>
          <Field
            label="First name"
            value={firstName}
            onChangeText={setFirstName}
            placeholder="Jane"
            autoCapitalize="words"
            textContentType="givenName"
            error={show("firstName")}
            style={styles.half}
          />
          <Field
            label="Last name"
            value={lastName}
            onChangeText={setLastName}
            placeholder="Smith"
            autoCapitalize="words"
            textContentType="familyName"
            error={show("lastName")}
            style={styles.half}
          />
        </View>
      </StepSection>

      <StepSection title="Identity">
        <Field
          label="Date of birth"
          value={dob}
          onChangeText={handleDobChange}
          placeholder="DD/MM/YYYY"
          keyboardType="number-pad"
          maxLength={10}
          hint="You must be at least 18."
          error={show("dob")}
        />
        <Field
          label="National Insurance number"
          value={nin}
          onChangeText={handleNinChange}
          placeholder="AB123456C"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={9}
          hint="Two letters, six numbers, one letter."
          error={show("nin")}
        />
      </StepSection>

      <StepSection title="Gender" hint="Some passengers ask for a female driver. We confirm this against your licence.">
        <SelectField
          label="Gender"
          placeholder="Choose"
          value={gender}
          onChange={setGender}
          options={[
            { value: "female", label: "Female" },
            { value: "male", label: "Male" },
            { value: "undisclosed", label: "Prefer not to say" },
          ]}
          error={show("gender")}
        />
      </StepSection>

      <StepSection title="Home address">
        <Field
          label="Address"
          value={address}
          onChangeText={setAddress}
          placeholder="House number, street, town, postcode"
          autoCapitalize="words"
          textContentType="fullStreetAddress"
          multiline
          error={show("address")}
        />
      </StepSection>

      {cities.length ? (
        <StepSection title="Where you'll drive" hint="You'll only be offered jobs picked up in this city. You can change it later in your account.">
          <SelectField
            label="Working city"
            title="Choose your city"
            placeholder="Choose a city"
            value={workingCityId}
            onChange={setWorkingCityId}
            options={cities.map((c) => ({ value: c.id, label: c.name }))}
            error={show("workingCityId")}
          />
        </StepSection>
      ) : null}

      <Banner
        tone="info"
        icon="lock-closed"
        title="Kept private"
        body="We only use these details to check you can drive with TakeARoute. They are never shown to passengers."
      />
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: SPACE[3] },
  half: { flex: 1 },
});
