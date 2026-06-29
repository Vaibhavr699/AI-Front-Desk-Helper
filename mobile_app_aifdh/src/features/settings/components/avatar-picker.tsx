import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { ActionSheetIOS, ActivityIndicator, Alert, Platform, Pressable, Text, View } from "react-native";

import { useRemoveAvatar, useUploadAvatar } from "../queries";

type Props = {
  avatarUrl: string | null;
  initials: string;
};

const IMAGE_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ["images"],
  allowsEditing: true,
  aspect: [1, 1],
  quality: 0.8,
};

export function AvatarPicker({ avatarUrl, initials }: Props) {
  const upload = useUploadAvatar();
  const remove = useRemoveAvatar();
  const busy = upload.isPending || remove.isPending;

  const [preview, setPreview] = useState<string | null>(null);
  const shown = preview ?? avatarUrl;

  async function pickFromLibrary() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow photo access to choose a profile picture.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync(IMAGE_OPTIONS);
    handleResult(result);
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow camera access to take a profile picture.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync(IMAGE_OPTIONS);
    handleResult(result);
  }

  function handleResult(result: ImagePicker.ImagePickerResult) {
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setPreview(asset.uri);
    upload.mutate(
      { uri: asset.uri, mimeType: asset.mimeType, fileName: asset.fileName },
      {
        onError: () => {
          setPreview(null);
          Alert.alert("Upload failed", "Couldn't update your photo. Please try again.");
        },
        onSuccess: () => setPreview(null),
      },
    );
  }

  function confirmRemove() {
    setPreview(null);
    remove.mutate();
  }

  function openMenu() {
    if (busy) return;
    const hasPhoto = Boolean(shown);
    if (Platform.OS === "ios") {
      const options = hasPhoto
        ? ["Take photo", "Choose from library", "Remove photo", "Cancel"]
        : ["Take photo", "Choose from library", "Cancel"];
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          destructiveButtonIndex: hasPhoto ? 2 : undefined,
          cancelButtonIndex: options.length - 1,
        },
        (i) => {
          if (i === 0) takePhoto();
          else if (i === 1) pickFromLibrary();
          else if (hasPhoto && i === 2) confirmRemove();
        },
      );
      return;
    }
    const buttons: { text: string; style?: "destructive" | "cancel"; onPress?: () => void }[] = [
      { text: "Take photo", onPress: takePhoto },
      { text: "Choose from library", onPress: pickFromLibrary },
    ];
    if (hasPhoto) buttons.push({ text: "Remove photo", style: "destructive", onPress: confirmRemove });
    buttons.push({ text: "Cancel", style: "cancel" });
    Alert.alert("Profile photo", undefined, buttons);
  }

  return (
    <Pressable onPress={openMenu} disabled={busy} className="active:opacity-80">
      <View className="h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-brand-100">
        {shown ? (
          <Image source={{ uri: shown }} style={{ height: 64, width: 64 }} contentFit="cover" transition={150} />
        ) : (
          <Text className="text-xl font-bold text-brand-700">{initials}</Text>
        )}
        {busy ? (
          <View className="absolute inset-0 items-center justify-center bg-black/35">
            <ActivityIndicator color="#fff" />
          </View>
        ) : null}
      </View>
      <View className="absolute -bottom-0.5 -right-0.5 h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-brand-600">
        <Ionicons name="camera" size={12} color="#fff" />
      </View>
    </Pressable>
  );
}
