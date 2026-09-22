import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import {
  doc,
  collection,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "../../../config/firebase";
import { COLORS } from '../../../components/ui/kit';


const PRIMARY = COLORS.green;
const SECONDARY = COLORS.blue;
const BG = COLORS.surface;
const DANGER = COLORS.red;

const PLACE_TYPES = {
  home: { icon: "home", label: "Home", color: "#E3F2FD", iconColor: SECONDARY },
  work: { icon: "briefcase", label: "Work", color: "#FFF3E0", iconColor: "#F57C00" },
  other: { icon: "location", label: "Saved", color: "#E8F5E9", iconColor: PRIMARY },
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

  const renderPlaceCard = (place) => {
    const style = getPlaceStyle(place.type);

    return (
      <TouchableOpacity
        key={place.id}
        style={styles.placeCard}
        onPress={() => openEditModal(place)}
        activeOpacity={0.7}
      >
        <View style={[styles.placeIcon, { backgroundColor: style.color }]}>
          <Ionicons name={style.icon} size={22} color={style.iconColor} />
        </View>

        <View style={styles.placeInfo}>
          <Text style={styles.placeName}>{place.name}</Text>
          <Text style={styles.placeAddress} numberOfLines={2}>
            {place.address}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => handleDeletePlace(place)}
        >
          <Ionicons name="trash-outline" size={18} color={DANGER} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const renderQuickAdd = () => {
    const hasHome = places.some((p) => p.type === "home");
    const hasWork = places.some((p) => p.type === "work");

    return (
      <View style={styles.quickAddSection}>
        {!hasHome && (
          <TouchableOpacity
            style={[styles.quickAddBtn, { backgroundColor: PLACE_TYPES.home.color }]}
            onPress={() => handleAddPlace("home")}
          >
            <Ionicons name="add" size={20} color={PLACE_TYPES.home.iconColor} />
            <Text style={[styles.quickAddText, { color: PLACE_TYPES.home.iconColor }]}>
              Add Home
            </Text>
          </TouchableOpacity>
        )}

        {!hasWork && (
          <TouchableOpacity
            style={[styles.quickAddBtn, { backgroundColor: PLACE_TYPES.work.color }]}
            onPress={() => handleAddPlace("work")}
          >
            <Ionicons name="add" size={20} color={PLACE_TYPES.work.iconColor} />
            <Text style={[styles.quickAddText, { color: PLACE_TYPES.work.iconColor }]}>
              Add Work
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Saved Places</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {renderQuickAdd()}

        <View style={styles.placesList}>
          {places.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="location-outline" size={48} color="#ddd" />
              <Text style={styles.emptyTitle}>No Saved Places</Text>
              <Text style={styles.emptySubtitle}>
                Add your home, work, or frequent destinations for quick access when booking rides.
              </Text>
            </View>
          ) : (
            places.map(renderPlaceCard)
          )}
        </View>

        {/* Add Custom Place */}
        <TouchableOpacity style={styles.addCustomBtn} onPress={() => handleAddPlace("other")}>
          <View style={[styles.placeIcon, { backgroundColor: COLORS.surface }]}>
            <Ionicons name="add" size={22} color={COLORS.muted} />
          </View>
          <Text style={styles.addCustomText}>Add a New Place</Text>
          <Ionicons name="chevron-forward" size={18} color={COLORS.faint} />
        </TouchableOpacity>
      </ScrollView>

      {/* Edit Modal */}
      <Modal
        visible={editModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setEditModalVisible(false)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Edit Place</Text>
            <TouchableOpacity onPress={handleUpdatePlace} disabled={saving}>
              {saving ? (
                <ActivityIndicator size="small" color={PRIMARY} />
              ) : (
                <Text style={styles.modalSave}>Save</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
            <View style={styles.editAddressBox}>
              <Ionicons name="location" size={20} color={PRIMARY} />
              <Text style={styles.editAddressText} numberOfLines={3}>
                {editingPlace?.address}
              </Text>
            </View>

            <Text style={styles.inputLabel}>Place Name</Text>
            <TextInput
              style={styles.nameInput}
              value={editName}
              onChangeText={setEditName}
              placeholder="Place name"
              placeholderTextColor={COLORS.faint}
            />

            <Text style={styles.inputLabel}>Place Type</Text>
            <View style={styles.typeSelector}>
              {Object.entries(PLACE_TYPES).map(([key, config]) => (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.typeOption,
                    editType === key && {
                      borderColor: config.iconColor,
                      backgroundColor: config.color,
                    },
                  ]}
                  onPress={() => setEditType(key)}
                >
                  <Ionicons
                    name={config.icon}
                    size={20}
                    color={editType === key ? config.iconColor : COLORS.faint}
                  />
                  <Text
                    style={[
                      styles.typeLabel,
                      editType === key && { color: config.iconColor, fontWeight: "600" },
                    ]}
                  >
                    {config.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  centered: {
    justifyContent: "center",
    alignItems: "center",
    flex: 1,
  },

  header: {
    backgroundColor: SECONDARY,
    paddingTop: 50,
    paddingBottom: 16,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.white,
  },

  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },

  quickAddSection: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 20,
  },
  quickAddBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
    gap: 6,
  },
  quickAddText: {
    fontSize: 14,
    fontWeight: "600",
  },

  placesList: {
    gap: 10,
  },
  placeCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    padding: 14,
    borderRadius: 14,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  placeIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  placeInfo: {
    flex: 1,
  },
  placeName: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.ink,
    marginBottom: 3,
  },
  placeAddress: {
    fontSize: 13,
    color: COLORS.muted,
    lineHeight: 18,
  },
  deleteBtn: {
    padding: 8,
  },

  emptyState: {
    alignItems: "center",
    paddingVertical: 50,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: COLORS.muted,
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 13,
    color: "#aaa",
    textAlign: "center",
    marginTop: 8,
    paddingHorizontal: 30,
    lineHeight: 20,
  },

  addCustomBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    padding: 14,
    borderRadius: 14,
    marginTop: 10,
    borderStyle: "dashed",
    borderWidth: 1.5,
    borderColor: "#ddd",
  },
  addCustomText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    color: "#555",
    marginLeft: 14,
  },

  // Edit Modal
  modalContainer: {
    flex: 1,
    backgroundColor: BG,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
    backgroundColor: COLORS.white,
  },
  modalCancel: {
    fontSize: 15,
    color: COLORS.muted,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: COLORS.ink,
  },
  modalSave: {
    fontSize: 15,
    fontWeight: "700",
    color: PRIMARY,
  },
  modalBody: {
    padding: 20,
  },
  editAddressBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#EBF2FA",
    padding: 14,
    borderRadius: 12,
    gap: 10,
    marginBottom: 20,
  },
  editAddressText: {
    flex: 1,
    fontSize: 13,
    color: SECONDARY,
    lineHeight: 20,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.muted,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  nameInput: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.ink,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  typeSelector: {
    flexDirection: "row",
    gap: 10,
  },
  typeOption: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.line,
    backgroundColor: COLORS.white,
    gap: 6,
  },
  typeLabel: {
    fontSize: 12,
    color: COLORS.muted,
  },
});