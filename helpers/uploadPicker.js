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
      mediaTypes: ['images'],
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
              mediaTypes: ['images'],
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
              size: asset.fileSize || null,
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
            // The Files picker sometimes gives no type; work it out from
            // the name so Storage does not refuse an "octet-stream".
            resolve({
              uri: asset.uri,
              mimeType: mimeTypeFor(asset.name, asset.mimeType),
              name: asset.name || "upload",
              size: asset.size || null,
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

// Storage only accepts images and PDFs under 10 MB (storage rules), so a bad
// file is refused here with a reason instead of a generic upload failure.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const MIME_BY_EXTENSION = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  webp: "image/webp",
  gif: "image/gif",
};

// The type to send with an upload: the picker's, or one worked out from the
// file name when the picker gave nothing useful.
export function mimeTypeFor(name, mimeType) {
  const known = mimeType && mimeType !== "application/octet-stream" ? mimeType : null;
  if (known) return known;
  const extension = inferUploadExtension(name, null);
  return MIME_BY_EXTENSION[extension] || "application/octet-stream";
}

export function isUploadTypeAllowed(mimeType) {
  return mimeType === "application/pdf" || /^image\//.test(mimeType || "");
}

// Throws a message the screen can show when the file cannot be uploaded.
export function assertUploadable(asset, blobSize) {
  const type = mimeTypeFor(asset.name, asset.mimeType);
  if (!isUploadTypeAllowed(type)) {
    throw new Error("Only photos and PDF files can be uploaded.");
  }
  const size = asset.size || blobSize || 0;
  if (size > MAX_UPLOAD_BYTES) {
    throw new Error("That file is too large. Please choose one under 10 MB.");
  }
  return type;
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
  // Refuse before reading when the picker told us the size; otherwise check
  // the blob, which is still before any bytes go up.
  const contentType = assertUploadable(asset);
  const blob = await uriToBlob(asset.uri);
  assertUploadable(asset, blob.size);
  const extension = inferUploadExtension(asset.name, contentType);
  const fileRef = ref(storage, `drivers/${driverId}/${name}.${extension}`);
  await uploadBytes(fileRef, blob, { contentType });
  blob.close?.();
  return getDownloadURL(fileRef);
}
