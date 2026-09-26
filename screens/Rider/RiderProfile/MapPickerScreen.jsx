import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
} from "react-native";
import { Alert } from "../../../components/ui/alert";
import MapView, { Marker } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import * as Location from "expo-location";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../../../config/firebase";
import {
  COLORS,
  TYPE,
  SPACE,
  RADIUS,
  SHADOW,
  Sheet,
  IconButton,
  Chip,
  Field,
  Button,
} from '../../../components/ui/kit';
import { GOOGLE_MAPS_API_KEY, PLACES_NEW_PROPS, placeCoords } from '../../../config/maps';

const PLACE_TYPES = {
  home: { icon: "home", label: "Home" },
  work: { icon: "briefcase", label: "Work" },
  other: { icon: "location", label: "Saved" },
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
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`
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
        `https://places.googleapis.com/v1/places:autocomplete?key=${GOOGLE_MAPS_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: text, languageCode: "en", includedRegionCodes: ["gb"] }),
        }
      );
      const data = await response.json();

      // Places (New) shapes, mapped onto the fields this screen renders.
      const found = (data.suggestions || [])
        .map((s) => s.placePrediction)
        .filter(Boolean)
        .map((p) => ({
          place_id: p.placeId,
          description: p.text?.text || "",
          structured_formatting: {
            main_text: p.structuredFormat?.mainText?.text,
            secondary_text: p.structuredFormat?.secondaryText?.text,
          },
        }));
      setPredictions(found);
      setShowPredictions(found.length > 0);
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
        `https://places.googleapis.com/v1/places/${prediction.place_id}?key=${GOOGLE_MAPS_API_KEY}&fields=${PLACES_NEW_PROPS.fields}`
      );
      const place = await response.json();
      const point = placeCoords(place);

      if (point) {
        const { latitude: lat, longitude: lng } = point;
        const newRegion = {
          latitude: lat,
          longitude: lng,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        };

        setRegion(newRegion);
        mapRef.current?.animateToRegion(newRegion, 1000);

        const formattedAddress = place.formattedAddress || prediction.description;
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
            other: place.displayName?.text || "Saved Place",
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
      accessibilityRole="button"
    >
      <View style={styles.predictionIcon}>
        <Ionicons name="location-outline" size={18} color={COLORS.midnight} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={TYPE.callout} numberOfLines={1}>
          {item.structured_formatting?.main_text || item.description}
        </Text>
        <Text style={TYPE.small} numberOfLines={1}>
          {item.structured_formatting?.secondary_text || ""}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
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
            anchor={{ x: 0.5, y: 1 }}
          >
            <View style={styles.markerContainer}>
              <View style={styles.markerPin} />
              <View style={styles.markerStem} />
            </View>
          </Marker>
        )}
      </MapView>

      {/* Search, floating over the map */}
      <SafeAreaView style={styles.topLayer} pointerEvents="box-none">
        <View style={styles.searchRow}>
          <IconButton icon="chevron-back" onPress={() => navigation.goBack()} accessibilityLabel="Go back" />
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={COLORS.muted} />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={searchPlaces}
              placeholder="Search address, postcode..."
              placeholderTextColor={COLORS.faint}
              selectionColor={COLORS.midnight}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => { setSearchQuery(""); setPredictions([]); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={18} color={COLORS.faint} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Predictions */}
        {showPredictions && predictions.length > 0 && (
          <View style={styles.predictions}>
            <FlatList
              data={predictions}
              keyExtractor={(item) => item.place_id}
              renderItem={renderPrediction}
              keyboardShouldPersistTaps="handled"
            />
          </View>
        )}
      </SafeAreaView>

      {/* GPS Button */}
      <View style={styles.gps}>
        {gettingGPS ? (
          <View style={styles.gpsBusy}>
            <ActivityIndicator size="small" color={COLORS.midnight} />
          </View>
        ) : (
          <IconButton icon="locate" onPress={getCurrentLocation} accessibilityLabel="Use my current location" />
        )}
      </View>

      {/* Bottom Sheet with Save Form */}
      <Sheet style={styles.sheet}>
        {/* Type Selector */}
        <View style={styles.typeSelector}>
          {Object.entries(PLACE_TYPES).map(([key, config]) => (
            <Chip
              key={key}
              label={config.label}
              icon={config.icon}
              active={selectedType === key}
              onPress={() => setSelectedType(key)}
            />
          ))}
        </View>

        {/* Name Input */}
        <Field
          left="bookmark-outline"
          value={placeName}
          onChangeText={setPlaceName}
          placeholder="Place name (e.g., Home, Office)"
          style={{ marginBottom: SPACE[3] }}
        />

        {/* Address */}
        {loadingAddress ? (
          <ActivityIndicator size="small" color={COLORS.midnight} style={styles.addressLoader} />
        ) : (
          <View style={styles.addressRow}>
            <Ionicons name="location" size={18} color={COLORS.limeInk} />
            <Text style={[TYPE.callout, { flex: 1 }]} numberOfLines={2}>
              {address || "Tap on the map or search to select a location"}
            </Text>
          </View>
        )}

        {/* Save Button */}
        <Button
          title="Save Place"
          icon="checkmark"
          onPress={handleSave}
          loading={saving}
          disabled={!selectedLocation || !placeName.trim() || saving}
        />
      </Sheet>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.surface,
  },
  map: { flex: 1 },

  topLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE[3],
    paddingHorizontal: SPACE[4],
    paddingTop: SPACE[2],
  },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE[2],
    minHeight: 48,
    paddingHorizontal: SPACE[4],
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.white,
    ...SHADOW.float,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: COLORS.ink,
    paddingVertical: SPACE[2],
  },

  predictions: {
    marginHorizontal: SPACE[4],
    marginTop: SPACE[2],
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    maxHeight: 260,
    overflow: "hidden",
    ...SHADOW.float,
  },
  predictionItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE[3],
    paddingHorizontal: SPACE[4],
    paddingVertical: SPACE[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.line,
  },
  predictionIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.fill,
    alignItems: "center", justifyContent: "center",
  },

  markerContainer: { alignItems: "center" },
  markerPin: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: COLORS.lime,
    borderWidth: 4, borderColor: COLORS.midnight,
  },
  markerStem: { width: 3, height: 12, backgroundColor: COLORS.midnight, borderRadius: 2 },

  gps: {
    position: "absolute",
    right: SPACE[4],
    bottom: 330,
  },
  gpsBusy: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.white,
    alignItems: "center", justifyContent: "center",
    ...SHADOW.float,
  },

  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
  },
  typeSelector: {
    flexDirection: "row",
    gap: SPACE[2],
    marginBottom: SPACE[4],
  },
  addressLoader: { marginVertical: SPACE[3] },
  addressRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: SPACE[2],
    marginBottom: SPACE[4],
    paddingHorizontal: SPACE[1],
  },
});
