import React, { useState, useEffect } from "react";
import { Alert } from "../../components/ui/alert";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db, auth } from "../../config/firebase";
import { captureSelfie, selectUploadAsset, uploadDriverFile } from "../../helpers/uploadPicker";
import { Banner, Field } from "../../components/ui/kit";
import { OnboardingFrame, StepSection, UploadTile } from "../../components/onboarding/kit";

// Each document: where it is stored (drivers/{uid}/{type}.ext, saved as
// {type}Url on the driver) and how it is described.
const LICENCE = [
  { type: "driverLicenseFront", title: "Driving licence, front", subtitle: "Photo card, all four corners in view", icon: "card-account-details-outline" },
  { type: "driverLicenseBack", title: "Driving licence, back", subtitle: "The side with the categories", icon: "card-bulleted-outline" },
];
const COMPLIANCE = [
  { type: "pcoLicense", title: "PCO licence", subtitle: "Your private hire driver licence", icon: "certificate-outline" },
  { type: "dbsCertificate", title: "Enhanced DBS certificate", subtitle: "Must be current", icon: "shield-check-outline", optional: true },
];

export default function IdentityVerificationScreen({ navigation, setOnboardingStatus }) {
  const driverId = auth.currentUser?.uid;

  const [urls, setUrls] = useState({});
  const [uploading, setUploading] = useState(null);
  const [shareCode, setShareCode] = useState("");
  const [saving, setSaving] = useState(false);

  // Load anything already uploaded.
  useEffect(() => {
    const fetchData = async () => {
      if (!driverId) return;

      try {
        const snap = await getDoc(doc(db, "drivers", driverId));
        if (!snap.exists()) return;

        const data = snap.data();
        // Older accounts stored a single licence image.
        const legacy = data.driverLicenseUrl || null;
        setUrls({
          driverLicenseFront: data.driverLicenseFrontUrl || legacy,
          driverLicenseBack: data.driverLicenseBackUrl || legacy,
          pcoLicense: data.pcoLicenseUrl || null,
          dbsCertificate: data.dbsCertificateUrl || null,
          selfie: data.selfieUrl || null,
        });
        setShareCode(data.rightToWorkShareCode || "");
      } catch (error) {
        console.log("Error fetching identity data:", error);
      }
    };

    fetchData();
  }, [driverId]);

  // Upload, then save the link straight away, so nothing is lost if they
  // leave before pressing Continue.
  const pickDocument = async (type) => {
    if (!driverId) return;

    // The selfie must be taken live with the front camera.
    const asset = type === "selfie" ? await captureSelfie() : await selectUploadAsset();
    if (!asset) return;

    if (asset.error) {
      Alert.alert("Permission needed", asset.error);
      return;
    }

    setUploading(type);
    try {
      const downloadUrl = await uploadDriverFile(driverId, type, asset);
      await setDoc(doc(db, "drivers", driverId), { [`${type}Url`]: downloadUrl }, { merge: true });
      setUrls((u) => ({ ...u, [type]: downloadUrl }));
    } catch (error) {
      console.log("Upload error:", error);
      Alert.alert("Upload failed", "That file did not upload. Check your connection and try again.");
    } finally {
      setUploading(null);
    }
  };

  const missing = [
    !urls.driverLicenseFront && "the front of your driving licence",
    !urls.driverLicenseBack && "the back of your driving licence",
    !urls.pcoLicense && "your PCO licence",
    !urls.selfie && "a selfie",
    !shareCode.trim() && "your Right to Work share code",
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
          onboardingStep: 3,
          onboardingComplete: false,
          rightToWorkShareCode: shareCode.trim().toUpperCase(),
          updatedAt: new Date(),
        },
        { merge: true }
      );

      setOnboardingStatus("onboarding");
      navigation.navigate("VehicleDetails");
    } catch (error) {
      console.log("Error saving identity info:", error);
      Alert.alert("Could not save", "Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const tile = (d) => (
    <UploadTile
      key={d.type}
      title={d.title}
      subtitle={d.subtitle}
      icon={d.icon}
      optional={d.optional}
      url={urls[d.type]}
      uploading={uploading === d.type}
      onPress={() => pickDocument(d.type)}
    />
  );

  const done = [urls.driverLicenseFront, urls.driverLicenseBack, urls.pcoLicense, urls.selfie].filter(Boolean).length;

  return (
    <OnboardingFrame
      step={2}
      title="Prove it's you"
      subtitle="UK private hire rules require these before you can take passengers."
      action={{ title: "Continue", onPress: handleContinue, loading: saving, icon: "arrow-forward" }}
      footerNote={`${done} of 4 required documents added`}
    >
      <StepSection title="Driving licence" hint="Take the photo on a flat, well-lit surface.">
        {LICENCE.map(tile)}
      </StepSection>

      <StepSection title="Private hire">
        {COMPLIANCE.map(tile)}
      </StepSection>

      <StepSection title="Selfie" hint="Taken live with your front camera, so we can match you to your licence.">
        {tile({ type: "selfie", title: "Take a selfie", subtitle: "Face the camera, no hat or sunglasses", icon: "camera-outline" })}
      </StepSection>

      <StepSection title="Right to work" hint="Get a share code from gov.uk/prove-right-to-work. It must be under 28 days old.">
        <Field
          label="Share code"
          value={shareCode}
          onChangeText={(t) => setShareCode(t.toUpperCase())}
          placeholder="ABC 123 DEF"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={11}
        />
      </StepSection>

      <Banner
        tone="info"
        icon="lock-closed"
        body="Your documents are stored securely and only seen by the TakeARoute team reviewing your application."
      />
    </OnboardingFrame>
  );
}
