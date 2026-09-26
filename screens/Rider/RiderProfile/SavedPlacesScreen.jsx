import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
} from "react-native";
import { Alert, AlertHost } from "../../../components/ui/alert";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import {
  doc,
  collection,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "../../../config/firebase";
import {
  COLORS,
  TYPE,
  SPACE,
  Screen,
  ScreenHeader,
  Section,
  Card,
  RowGroup,
  Button,
  Chip,
  Field,
  EmptyState,
  Loading,
} from '../../../components/ui/kit';

const PLACE_TYPES = {
  home: { icon: "home", label: "Home" },
  work: { icon: "briefcase", label: "Work" },
  other: { icon: "location", label: "Saved" },
};

export default function SavedPlacesScreen() {
  const navigation = useNavigation();
  const user = auth.currentUser;

  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Edit modal state
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingPlace, setEditingPlace] = useState(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState("other");

  // Real-time listener
  useEffect(() => {
    if (!user) {
      navigation.goBack();
      return;
    }

    const placesRef = collection(db, "riders", user.uid, "savedPlaces");
    const unsubscribe = onSnapshot(
      placesRef,
      (snapshot) => {
        const placesList = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        // Sort: home first, then work, then others
        placesList.sort((a, b) => {
          const order = { home: 0, work: 1, other: 2 };
          return (order[a.type] || 2) - (order[b.type] || 2);
        });
        setPlaces(placesList);
        setLoading(false);
      },
      (error) => {
        console.error("Snapshot error:", error);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [user]);

  const handleAddPlace = (type) => {
    navigation.navigate("MapPicker", { placeType: type });
  };

  const openEditModal = (place) => {
    setEditingPlace(place);
    setEditName(place.name);
    setEditType(place.type);
    setEditModalVisible(true);
  };

  const handleUpdatePlace = async () => {
    if (!editName.trim()) {
      Alert.alert("Error", "Name cannot be empty");
      return;
    }

    setSaving(true);
    try {
      const placeDoc = doc(db, "riders", user.uid, "savedPlaces", editingPlace.id);
      await updateDoc(placeDoc, {
        name: editName.trim(),
        type: editType,
        updatedAt: serverTimestamp(),
      });
      setEditModalVisible(false);
    } catch (error) {
      console.error("Update error:", error);
      Alert.alert("Error", "Failed to update place");
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePlace = (place) => {
    Alert.alert("Delete Place", `Remove "${place.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            const placeDoc = doc(db, "riders", user.uid, "savedPlaces", place.id);
            await deleteDoc(placeDoc);
          } catch (error) {
            Alert.alert("Error", "Failed to delete place");
          }
        },
      },
    ]);
  };

  const getPlaceStyle = (type) => PLACE_TYPES[type] || PLACE_TYPES.other;

  const hasHome = places.some((p) => p.type === "home");
  const hasWork = places.some((p) => p.type === "work");

  if (loading) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen>
        <ScreenHeader title="Saved Places" />

        {(!hasHome || !hasWork) && (
          <View style={styles.quickAdd}>
            {!hasHome && (
              <Button title="Add Home" icon="home-outline" variant="secondary" size="small" onPress={() => handleAddPlace("home")} />
            )}
            {!hasWork && (
              <Button title="Add Work" icon="briefcase-outline" variant="secondary" size="small" onPress={() => handleAddPlace("work")} />
            )}
          </View>
        )}

        <Section>
          {places.length === 0 ? (
            <EmptyState
              icon="location-outline"
              title="No Saved Places"
              body="Add your home, work, or frequent destinations for quick access when booking rides."
            />
          ) : (
            <RowGroup
              items={places.map((place) => {
                const style = getPlaceStyle(place.type);
                return {
                  key: place.id,
                  icon: style.icon,
                  iconColor: COLORS.midnight,
                  title: place.name,
                  detail: place.address,
                  onPress: () => openEditModal(place),
                  right: (
                    <TouchableOpacity
                      style={styles.deleteBtn}
                      onPress={() => handleDeletePlace(place)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${place.name}`}
                    >
                      <Ionicons name="trash-outline" size={18} color={COLORS.red} />
                    </TouchableOpacity>
                  ),
                };
              })}
            />
          )}
        </Section>

        <Button title="Add a New Place" icon="add" style={{ marginTop: SPACE[5] }} onPress={() => handleAddPlace("other")} />

      {/* Edit Modal */}
      <Modal
        visible={editModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <Screen contentStyle={{ paddingHorizontal: 0 }}>
          <ScreenHeader
            compact
            title="Edit Place"
            onBack={() => setEditModalVisible(false)}
            right={<Button title="Save" size="small" onPress={handleUpdatePlace} loading={saving} disabled={saving} />}
          />

          <View style={{ paddingHorizontal: SPACE[5], paddingTop: SPACE[3] }}>
            <Card>
              <View style={styles.addressRow}>
                <Ionicons name="location" size={20} color={COLORS.limeInk} />
                <Text style={[TYPE.callout, { flex: 1 }]} numberOfLines={3}>
                  {editingPlace?.address}
                </Text>
              </View>
            </Card>

            <Field
              label="Place Name"
              left="bookmark-outline"
              value={editName}
              onChangeText={setEditName}
              placeholder="Place name"
              style={{ marginTop: SPACE[5] }}
            />

            <Text style={styles.fieldLabel}>Place Type</Text>
            <View style={styles.typeSelector}>
              {Object.entries(PLACE_TYPES).map(([key, config]) => (
                <Chip
                  key={key}
                  label={config.label}
                  icon={config.icon}
                  active={editType === key}
                  onPress={() => setEditType(key)}
                />
              ))}
            </View>
          </View>
        </Screen>
        <AlertHost />
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  quickAdd: { flexDirection: "row", gap: SPACE[3], marginTop: SPACE[4], flexWrap: "wrap" },
  deleteBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.redSoft,
    alignItems: "center", justifyContent: "center",
  },
  addressRow: { flexDirection: "row", alignItems: "flex-start", gap: SPACE[3] },
  fieldLabel: { fontSize: 13, fontWeight: "700", color: COLORS.inkSoft, marginBottom: SPACE[2] },
  typeSelector: { flexDirection: "row", gap: SPACE[2], flexWrap: "wrap" },
});
