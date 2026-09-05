import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import * as Location from "expo-location";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../../../config/firebase";

const PRIMARY = "#79B531";
const SECONDARY = "#235594";
const BG = "#F8F9FA";

const GOOGLE_PLACES_API_KEY = "AIzaSyBtmcvJE-m_v44Z2lLDm8wDgI6GGYLXimQ";

const PLACE_TYPES = {
  home: { icon: "home", label: "Home", color: "#E3F2FD", iconColor: SECONDARY },
  work: { icon: "briefcase", label: "Work", color: "#FFF3E0", iconColor: "#F57C00" },
  other: { icon: "location", label: "Saved", color: "#E8F5E9", iconColor: PRIMARY },
};

export default function MapPickerScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { placeType = "other" } = route.params || {};

  const mapRef = useRef(null);
  const user = auth.currentUser;

  const [searchQuery, setSearchQuery] = useState("");
  const [predictions, setPredictions] = useState([]);
  const [showPredictions, setShowPredictions] = useState(false);

  const [selectedLocation, setSelectedLocation] = useState(null);
  const [address, setAddress] = useState("");
  const [loadingAddress, setLoadingAddress] = useState(false);
  const [gettingGPS, setGettingGPS] = useState(false);
  const [saving, setSaving] = useState(false);

  const [placeName, setPlaceName] = useState("");
  const [selectedType, setSelectedType] = useState(placeType);

  const [region, setRegion] = useState({
    latitude: 51.5074,
    longitude: -0.1278,
    latitudeDelta: 0.0922,
    longitudeDelta: 0.0421,
  });

  useEffect(() => {
    getCurrentLocation();
  }, []);

  const getCurrentLocation = async () => {
    setGettingGPS(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission Denied", "Location permission is required");
        setGettingGPS(false);
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const { latitude, longitude } = location.coords;
      const newRegion = {
        latitude,
        longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      };

      setRegion(newRegion);
      mapRef.current?.animateToRegion(newRegion, 1000);
      await reverseGeocode(latitude, longitude);
    } catch (error) {
      console.error("GPS error:", error);
    } finally {
      setGettingGPS(false);
    }
  };

  const reverseGeocode = async (lat, lng) => {
    setLoadingAddress(true);
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_PLACES_API_KEY}`
      );
      const data = await response.json();

      if (data.results?.[0]) {
        const result = data.results[0];
        setAddress(result.formatted_address);
        setSelectedLocation({
          latitude: lat,
          longitude: lng,
          address: result.formatted_address,
          placeId: result.place_id,
        });
        // Auto-suggest name based on type
        if (!placeName) {
          const suggestedNames = {
            home: "Home",
            work: "Work",
            other: result.name || "Saved Place",
          };
          setPlaceName(suggestedNames[selectedType] || "");
        }
      }
    } catch (error) {
      console.error("Reverse geocode error:", error);
    } finally {
      setLoadingAddress(false);
    }
  };

  const searchPlaces = async (text) => { 
    setSearchQuery(text);
    if (text.length < 2) {
      setPredictions([]);
      setShowPredictions(false);
      return;
    }

    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
          text
        )}&components=country:gb&key=${GOOGLE_PLACES_API_KEY}`
      );
      const data = await response.json();

      if (data.predictions) {
        setPredictions(data.predictions);
        setShowPredictions(true);
      }
    } catch (error) {
      console.error("Places search error:", error);
    }
  };

  const selectPrediction = async (prediction) => {
    setShowPredictions(false);
    setSearchQuery(prediction.description);
    setPredictions([]);

    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?place_id=${prediction.place_id}&fields=geometry,formatted_address,name&key=${GOOGLE_PLACES_API_KEY}`
      );
      const data = await response.json();

      if (data.result?.geometry) {
        const { lat, lng } = data.result.geometry.location;
        const newRegion = {
          latitude: lat,
          longitude: lng,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        };

        setRegion(newRegion);
        mapRef.current?.animateToRegion(newRegion, 1000);

        const formattedAddress = data.result.formatted_address || prediction.description;
        setAddress(formattedAddress);
        setSelectedLocation({
          latitude: lat,
          longitude: lng,
          address: formattedAddress,
          placeId: prediction.place_id,
        });

        // Auto-suggest name
        if (!placeName) {
          const suggestedNames = {
            home: "Home",
            work: "Work",
            other: data.result.name || "Saved Place",
          };
          setPlaceName(suggestedNames[selectedType] || "");
        }
      }
    } catch (error) {
      console.error("Place details error:", error);
    }
  };

  const handleMapPress = (e) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    reverseGeocode(latitude, longitude);

    const newRegion = {
      latitude,
      longitude,
      latitudeDelta: region.latitudeDelta,
      longitudeDelta: region.longitudeDelta,
    };
    setRegion(newRegion);
  };

  const handleSave = async () => {
    if (!selectedLocation) {
      Alert.alert("Error", "Please select a location on the map");
      return;
    }

    if (!placeName.trim()) {
      Alert.alert("Error", "Please give this place a name");
      return;
    }

    setSaving(true);
    try {
      const placesRef = collection(db, "riders", user.uid, "savedPlaces");

      await addDoc(placesRef, {
        type: selectedType,
        name: placeName.trim(),
        address: selectedLocation.address,
        latitude: selectedLocation.latitude,
        longitude: selectedLocation.longitude,
        placeId: selectedLocation.placeId || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      Alert.alert("Success", "Place saved successfully", [
        { text: "OK", onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      console.error("Save error:", error);
      Alert.alert("Error", "Failed to save place");
      setSaving(false);
    }
  };

  const renderPrediction = ({ item }) => (
    <TouchableOpacity
      style={styles.predictionItem}
      onPress={() => selectPrediction(item)}
    >
      <Ionicons name="location-outline" size={18} color={PRIMARY} />
      <View style={styles.predictionText}>
        <Text style={styles.predictionMain} numberOfLines={1}>
          {item.structured_formatting?.main_text || item.description}
        </Text>
        <Text style={styles.predictionSecondary} numberOfLines={1}>
          {item.structured_formatting?.secondary_text || ""}
        </Text>
      </View>
    </TouchableOpacity>
  );

  const getTypeConfig = (type) => PLACE_TYPES[type] || PLACE_TYPES.other;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Search Header */}
      <View style={styles.searchHeader}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.searchInputContainer}>
          <Ionicons name="search" size={18} color="#999" />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={searchPlaces}
            placeholder="Search address, postcode..."
            placeholderTextColor="#999"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => { setSearchQuery(""); setPredictions([]); }}>
              <Ionicons name="close-circle" size={18} color="#999" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Predictions */}
      {showPredictions && predictions.length > 0 && (
        <View style={styles.predictionsContainer}>
          <FlatList
            data={predictions}
            keyExtractor={(item) => item.place_id}
            renderItem={renderPrediction}
            keyboardShouldPersistTaps="handled"
          />
        </View>
      )}

      {/* Map */}
      <MapView
        ref={mapRef}
        style={styles.map}
        region={region}
        onPress={handleMapPress}
      >
        {selectedLocation && (
          <Marker
            coordinate={{
              latitude: selectedLocation.latitude,
              longitude: selectedLocation.longitude,
            }}
            draggable
            onDragEnd={(e) => {
              const { latitude, longitude } = e.nativeEvent.coordinate;
              reverseGeocode(latitude, longitude);
            }}
          >
            <View style={styles.markerContainer}>
              <View style={styles.markerPin}>
                <Ionicons name="location" size={28} color={PRIMARY} />
              </View>
              <View style={styles.markerShadow} />
            </View>
          </Marker>
        )}
      </MapView>

      {/* GPS Button */}
      <TouchableOpacity
        style={styles.gpsButton}
        onPress={getCurrentLocation}
        disabled={gettingGPS}
      >
        {gettingGPS ? (
          <ActivityIndicator size="small" color={SECONDARY} />
        ) : (
          <Ionicons name="locate" size={24} color={SECONDARY} />
        )}
      </TouchableOpacity>

      {/* Bottom Sheet with Save Form */}
      <View style={styles.bottomSheet}>
        <View style={styles.dragHandle} />

        {/* Type Selector */}
        <View style={styles.typeSelector}>
          {Object.entries(PLACE_TYPES).map(([key, config]) => (
            <TouchableOpacity
              key={key}
              style={[
                styles.typeOption,
                selectedType === key && {
                  borderColor: config.iconColor,
                  backgroundColor: config.color,
                },
              ]}
              onPress={() => setSelectedType(key)}
            >
              <Ionicons
                name={config.icon}
                size={18}
                color={selectedType === key ? config.iconColor : "#999"}
              />
              <Text
                style={[
                  styles.typeLabel,
                  selectedType === key && { color: config.iconColor, fontWeight: "600" },
                ]}
              >
                {config.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Name Input */}
        <TextInput
          style={styles.nameInput}
          value={placeName}
          onChangeText={setPlaceName}
          placeholder="Place name (e.g., Home, Office)"
          placeholderTextColor="#bbb"
        />

        {/* Address */}
        {loadingAddress ? (
          <ActivityIndicator size="small" color={PRIMARY} style={styles.addressLoader} />
        ) : (
          <View style={styles.addressContainer}>
            <Ionicons name="location" size={18} color={PRIMARY} />
            <Text style={styles.addressText} numberOfLines={2}>
              {address || "Tap on the map or search to select a location"}
            </Text>
          </View>
        )}

        {/* Save Button */}
        <TouchableOpacity
          style={[
            styles.confirmButton,
            (!selectedLocation || !placeName.trim()) && styles.confirmButtonDisabled,
          ]}
          onPress={handleSave}
          disabled={!selectedLocation || !placeName.trim() || saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Text style={styles.confirmButtonText}>Save Place</Text>
              <Ionicons name="checkmark" size={18} color="#fff" />
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },

  searchHeader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 50,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: SECONDARY,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginLeft: 10,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: "#1a1a1a",
  },

  predictionsContainer: {
    position: "absolute",
    top: 110,
    left: 16,
    right: 16,
    zIndex: 20,
    backgroundColor: "#fff",
    borderRadius: 12,
    maxHeight: 250,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  predictionItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    gap: 12,
  },
  predictionText: {
    flex: 1,
  },
  predictionMain: {
    fontSize: 14,
    fontWeight: "500",
    color: "#1a1a1a",
  },
  predictionSecondary: {
    fontSize: 12,
    color: "#888",
    marginTop: 2,
  },

  map: {
    flex: 1,
    marginTop: 60,
  },

  markerContainer: {
    alignItems: "center",
  },
  markerPin: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  markerShadow: {
    width: 12,
    height: 4,
    backgroundColor: "rgba(0,0,0,0.2)",
    borderRadius: 6,
    marginTop: 2,
  },

  gpsButton: {
    position: "absolute",
    right: 16,
    bottom: 320,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },

  bottomSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 30,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 10,
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: "#ddd",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 12,
  },

  typeSelector: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  typeOption: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#eee",
    backgroundColor: "#fff",
    gap: 4,
  },
  typeLabel: {
    fontSize: 11,
    color: "#888",
  },

  nameInput: {
    backgroundColor: "#F5F5F5",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: "#1a1a1a",
    marginBottom: 10,
  },

  addressLoader: {
    marginVertical: 12,
  },
  addressContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  addressText: {
    flex: 1,
    fontSize: 13,
    color: "#666",
    lineHeight: 18,
  },

  confirmButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: PRIMARY,
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
  },
  confirmButtonDisabled: {
    backgroundColor: "#ccc",
  },
  confirmButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});