import { Alert } from "../components/ui/alert";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../config/firebase";

// Live selfie: opens the front camera only. No gallery option, so a driver
// cannot submit an old or borrowed photo.
export async function captureSelfie() {
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      return { error: "Allow camera access to take your selfie." };
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      cameraType: ImagePicker.CameraType.front,
      allowsEditing: false,
      quality: 0.7,
    });

    if (result.canceled) return null;

    const asset = result.assets[0];
    return {
      uri: asset.uri,
      mimeType: asset.mimeType || "image/jpeg",
      name: asset.fileName || "selfie.jpg",
    };
  } catch (error) {
    console.log("Camera error:", error);
    return { error: "The camera could not be opened on this device." };
  }
}

export async function selectUploadAsset() {
  return new Promise((resolve) => {
    Alert.alert(
      "Select Upload",
      "Choose how you want to upload this document.",
      [
        {
          text: "Photos",
          onPress: async () => {
            const permission =
              await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!permission.granted) {
              resolve({ error: "Allow photo library access to upload images." });
              return;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              quality: 0.7,
            });

            if (result.canceled) {
              resolve(null);
              return;
            }

            const asset = result.assets[0];
            resolve({
              uri: asset.uri,
              mimeType: asset.mimeType || "image/jpeg",
              name: asset.fileName || "upload.jpg",
            });
          },
        },
        {
          text: "Files",
          onPress: async () => {
            const result = await DocumentPicker.getDocumentAsync({
              type: ["image/*", "application/pdf"],
              copyToCacheDirectory: true,
              multiple: false,
            });

            if (result.canceled) {
              resolve(null);
              return;
            }

            const asset = result.assets[0];
            resolve({
              uri: asset.uri,
              mimeType: asset.mimeType || "application/octet-stream",
              name: asset.name || "upload",
            });
          },
        },
        {
          text: "Cancel",
          style: "cancel",
          onPress: () => resolve(null),
        },
      ]
    );
  });
}

export function inferUploadExtension(name, mimeType) {
  const sanitizedName = name || "";
  const nameParts = sanitizedName.split(".");
  const explicitExtension =
    nameParts.length > 1 ? nameParts[nameParts.length - 1].toLowerCase() : "";

  if (explicitExtension) {
    return explicitExtension;
  }

  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/heic") return "heic";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

export function isPdfUpload(value) {
  if (!value) return false;
  return value.toLowerCase().includes(".pdf");
}

// Reads a local file into a Blob using XMLHttpRequest. On Android,
// fetch(uri).blob() often returns a blob with an empty type or fails outright,
// which Firebase Storage then rejects.
export function uriToBlob(uri) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => resolve(xhr.response);
    xhr.onerror = () => reject(new Error("Could not read the selected file."));
    xhr.responseType = "blob";
    xhr.open("GET", uri, true);
    xhr.send(null);
  });
}

// Uploads a picked file to drivers/{uid}/{name}.{ext} and returns its
// download URL. Driver sign-up and the documents screen share this, so every
// upload goes through the Android-safe uriToBlob and sends a content type.
export async function uploadDriverFile(driverId, name, asset) {
  const blob = await uriToBlob(asset.uri);
  const extension = inferUploadExtension(asset.name, asset.mimeType);
  const fileRef = ref(storage, `drivers/${driverId}/${name}.${extension}`);
  await uploadBytes(fileRef, blob, asset.mimeType ? { contentType: asset.mimeType } : undefined);
  return getDownloadURL(fileRef);
}
