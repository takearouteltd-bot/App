import { Alert } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";

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
