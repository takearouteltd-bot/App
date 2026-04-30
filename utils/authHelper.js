// utils/authHelper.js
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../config/firebase";

export async function handlePostLogin(
  user,
  navigation,
  setUserRole,
  setRiderOnboardingStatus,
  setDriverOnboardingStatus
) {
  const uid = user.uid;
  const userRef = doc(db, "users", uid);
  const userDoc = await getDoc(userRef);

  if (!userDoc.exists()) {
    await setDoc(userRef, {
      email: user.email || null,
      phoneNumber: user.phoneNumber || null,
      role: null,
      createdAt: new Date(),
      authProvider: user.providerData[0]?.providerId || "unknown",
    });
    navigation.navigate("SelectUserType");
    return;
  }

  const userData = userDoc.data();
  const role = userData.role;

  if (!role) {
    navigation.navigate("SelectUserType");
    return;
  }

  setUserRole(role);

  if (role === "rider") {
    const riderDoc = await getDoc(doc(db, "riders", uid));
    if (riderDoc.exists()) {
      const data = riderDoc.data();
      if (!data.fullName) {
        setRiderOnboardingStatus("profile");
      } else if (!data.locationEnabled) {
        setRiderOnboardingStatus("location");
      } else {
        setRiderOnboardingStatus("complete");
      }
    } else {
      setRiderOnboardingStatus("profile");
    }
  }

  if (role === "driver") {
    const driverDoc = await getDoc(doc(db, "drivers", uid));
    if (driverDoc.exists()) {
      const data = driverDoc.data();
      if (data.onboardingComplete) {
        setDriverOnboardingStatus("complete");
      } else {
        setDriverOnboardingStatus("onboarding");
      }
    } else {
      setDriverOnboardingStatus("onboarding");
    }
  }
}