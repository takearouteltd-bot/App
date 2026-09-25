import React, { useState, useEffect } from "react";
import { View, StyleSheet } from "react-native";
import { Alert } from "../../components/ui/alert";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db, auth } from "../../config/firebase";
import { selectUploadAsset, uploadDriverFile } from "../../helpers/uploadPicker";
import { VEHICLE_CLASSES } from "../../constants/vehicleClasses";
import { Field, SPACE } from "../../components/ui/kit";
import { ChoiceCard, OnboardingFrame, StepSection, UploadTile } from "../../components/onboarding/kit";

// The icon for each class; ids, names and seats come from constants/vehicleClasses
// so what a driver picks here matches what passengers book.
const CLASS_ICON = {
  RouteMini: "car-hatchback",
  RoutePlus: "car-side",
  RouteXL: "van-passenger",
  RouteEco: "leaf",
  RouteExecutive: "car-estate",
};

// Upload name (drivers/{uid}/{name}.ext) → the field it is saved as.
const DOC_FIELD = {
  motCert: "motUrl",
  phvInsurance: "insuranceUrl",
  companyAgreement: "companyAgreementUrl",
};

const thisYear = new Date().getFullYear();
const isValidYear = (y) => /^\d{4}$/.test(y) && Number(y) >= 1990 && Number(y) <= thisYear + 1;

export default function VehicleDetailsScreen({ navigation, setOnboardingStatus }) {
  const driverId = auth.currentUser?.uid;

  const [makeModel, setMakeModel] = useState("");
  const [year, setYear] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [ownershipType, setOwnershipType] = useState(null); // "company" | "private"

  const [urls, setUrls] = useState({});
  const [uploading, setUploading] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      if (!driverId) return;

      try {
        const snap = await getDoc(doc(db, "drivers", driverId));
        if (!snap.exists()) return;

        const data = snap.data();
        setMakeModel(data.makeModel || "");
        setYear(data.year || "");
        setRegistrationNumber(data.registrationNumber || "");
        setVehicleType(data.vehicleType || "");
        setOwnershipType(data.ownershipType || null);
        setUrls({
          motCert: data.motUrl || null,
          phvInsurance: data.insuranceUrl || null,
          companyAgreement: data.companyAgreementUrl || null,
        });
      } catch (error) {
        console.log("Error fetching vehicle data:", error);
      }
    };

    fetchData();
  }, [driverId]);

  // Upload, then save the link straight away.
  const pickDocument = async (type) => {
    if (!driverId) return;

    const asset = await selectUploadAsset();
    if (!asset) return;

    if (asset.error) {
      Alert.alert("Permission needed", asset.error);
      return;
    }

    setUploading(type);
    try {
      const downloadUrl = await uploadDriverFile(driverId, type, asset);
      await setDoc(doc(db, "drivers", driverId), { [DOC_FIELD[type]]: downloadUrl }, { merge: true });
      setUrls((u) => ({ ...u, [type]: downloadUrl }));
    } catch (error) {
      console.log("Upload error:", error);
      Alert.alert("Upload failed", "That file did not upload. Check your connection and try again.");
    } finally {
      setUploading(null);
    }
  };

  const missing = [
    !makeModel.trim() && "the make and model",
    !isValidYear(year) && "the year it was made",
    !registrationNumber.trim() && "the registration",
    !vehicleType && "a vehicle class",
    !ownershipType && "who owns the vehicle",
    !urls.motCert && "the MOT certificate",
    !urls.phvInsurance && "your PHV insurance",
    ownershipType === "company" && !urls.companyAgreement && "the company agreement",
  ].filter(Boolean);

  const handleContinue = async () => {
    if (missing.length) {
      Alert.alert("Almost there", `Please add ${missing.join(", ")}.`);
      return;
    }

    setSaving(true);
    try {
      await setDoc(
        doc(db, "drivers", driverId),
        {
          makeModel: makeModel.trim(),
          year,
          registrationNumber: registrationNumber.replace(/\s+/g, " ").trim().toUpperCase(),
          vehicleType,
          ownershipType,
          onboardingStep: 4,
          onboardingComplete: false,
          updatedAt: new Date(),
        },
        { merge: true }
      );

      setOnboardingStatus("onboarding");
      navigation.navigate("PayoutDetails");
    } catch (error) {
      console.log("Error saving vehicle:", error);
      Alert.alert("Could not save", "Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <OnboardingFrame
      step={3}
      title="Your vehicle"
      subtitle="The car you'll drive with TakeARoute. It sets which trips you're offered."
      action={{ title: "Continue", onPress: handleContinue, loading: saving, icon: "arrow-forward" }}
    >
      <StepSection title="The car">
        <Field
          label="Make and model"
          value={makeModel}
          onChangeText={setMakeModel}
          placeholder="Toyota Prius"
          autoCapitalize="words"
        />
        <View style={styles.row}>
          <Field
            label="Year"
            value={year}
            onChangeText={(t) => setYear(t.replace(/\D/g, "").slice(0, 4))}
            placeholder={String(thisYear - 3)}
            keyboardType="number-pad"
            maxLength={4}
            style={styles.year}
          />
          <Field
            label="Registration"
            value={registrationNumber}
            onChangeText={(t) => setRegistrationNumber(t.toUpperCase())}
            placeholder="AB12 CDE"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
            style={styles.reg}
          />
        </View>
      </StepSection>

      <StepSection
        title="Vehicle class"
        hint="You'll get trips for this class and any class below it."
      >
        {VEHICLE_CLASSES.map((c) => (
          <ChoiceCard
            key={c.id}
            title={c.label}
            detail={c.description}
            meta={`${c.seats} seats`}
            icon={CLASS_ICON[c.id] || "car"}
            selected={vehicleType === c.id}
            onPress={() => setVehicleType(c.id)}
          />
        ))}
      </StepSection>

      <StepSection title="Who owns it?">
        <View style={styles.row}>
          <ChoiceCard
            title="I do"
            icon="account-outline"
            selected={ownershipType === "private"}
            onPress={() => setOwnershipType("private")}
            style={styles.half}
          />
          <ChoiceCard
            title="A company"
            icon="office-building-outline"
            selected={ownershipType === "company"}
            onPress={() => setOwnershipType("company")}
            style={styles.half}
          />
        </View>
      </StepSection>

      <StepSection title="Documents" hint="A clear photo or PDF of each.">
        <UploadTile
          title="MOT certificate"
          subtitle="Current and in date"
          icon="certificate-outline"
          url={urls.motCert}
          uploading={uploading === "motCert"}
          onPress={() => pickDocument("motCert")}
        />
        <UploadTile
          title="PHV insurance"
          subtitle="Hire and reward cover"
          icon="shield-car"
          url={urls.phvInsurance}
          uploading={uploading === "phvInsurance"}
          onPress={() => pickDocument("phvInsurance")}
        />
        {ownershipType === "company" ? (
          <UploadTile
            title="Company agreement"
            subtitle="Showing you're allowed to drive it"
            icon="file-sign"
            url={urls.companyAgreement}
            uploading={uploading === "companyAgreement"}
            onPress={() => pickDocument("companyAgreement")}
          />
        ) : null}
      </StepSection>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: SPACE[3] },
  half: { flex: 1 },
  year: { width: 110 },
  reg: { flex: 1 },
});
