// import React, { useEffect, useRef } from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   Animated,
//   Easing,
// } from "react-native";

// const PRIMARY = "#79B531";
// const SECONDARY = "#235594";

// export default function SplashScreen() {
//   const fadeAnim = useRef(new Animated.Value(0)).current;
//   const scaleAnim = useRef(new Animated.Value(0.8)).current;
//   const slideAnim = useRef(new Animated.Value(30)).current;
//   const pulseAnim = useRef(new Animated.Value(1)).current;

//   useEffect(() => {
//     // Entry animation
//     Animated.parallel([
//       Animated.timing(fadeAnim, {
//         toValue: 1,
//         duration: 800,
//         useNativeDriver: true,
//         easing: Easing.ease,
//       }),
//       Animated.timing(scaleAnim, {
//         toValue: 1,
//         duration: 800,
//         useNativeDriver: true,
//         easing: Easing.out(Easing.back(1.5)),
//       }),
//       Animated.timing(slideAnim, {
//         toValue: 0,
//         duration: 800,
//         useNativeDriver: true,
//         easing: Easing.out(Easing.cubic),
//       }),
//     ]).start();

//     // Subtle pulse loop on logo
//     Animated.loop(
//       Animated.sequence([
//         Animated.timing(pulseAnim, {
//           toValue: 1.05,
//           duration: 1500,
//           useNativeDriver: true,
//           easing: Easing.inOut(Easing.ease),
//         }),
//         Animated.timing(pulseAnim, {
//           toValue: 1,
//           duration: 1500,
//           useNativeDriver: true,
//           easing: Easing.inOut(Easing.ease),
//         }),
//       ])
//     ).start();
//   }, []);

//   return (
//     <View style={styles.container}>
//       {/* Logo Container */}
//       <Animated.View
//         style={[
//           styles.logoContainer,
//           {
//             opacity: fadeAnim,
//             transform: [{ scale: scaleAnim }],
//           },
//         ]}
//       >
//         {/* Animated Logo Mark */}
//         <Animated.View
//           style={[
//             styles.logoMark,
//             { transform: [{ scale: pulseAnim }] },
//           ]}
//         >
//           <View style={styles.logoInner}>
//             <Text style={styles.logoLetter}>T</Text>
//           </View>
//           {/* Route line decoration */}
//           <View style={styles.routeLine} />
//           <View style={[styles.routeDot, styles.routeDotStart]} />
//           <View style={[styles.routeDot, styles.routeDotEnd]} />
//         </Animated.View>
//       </Animated.View>

//       {/* Brand Name */}
//       <Animated.View
//         style={[
//           styles.brandContainer,
//           {
//             opacity: fadeAnim,
//             transform: [{ translateY: slideAnim }],
//           },
//         ]}
//       >
//         <Text style={styles.brandName}>
//           Take
//           <Text style={styles.brandNameHighlight}>ARoute</Text>
//         </Text>
//         <Text style={styles.tagline}>Your ride, your way</Text>
//       </Animated.View>

//       {/* Loading Indicator */}
//       <Animated.View
//         style={[
//           styles.loaderContainer,
//           { opacity: fadeAnim },
//         ]}
//       >
//         <View style={styles.loaderTrack}>
//           <Animated.View
//             style={[
//               styles.loaderFill,
//               {
//                 transform: [
//                   {
//                     translateX: fadeAnim.interpolate({
//                       inputRange: [0, 1],
//                       outputRange: [-100, 0],
//                     }),
//                   },
//                 ],
//               },
//             ]}
//           />
//         </View>
//         <Text style={styles.loaderText}>Loading...</Text>
//       </Animated.View>

//       {/* Version */}
//       <Animated.Text
//         style={[
//           styles.versionText,
//           { opacity: fadeAnim },
//         ]}
//       >
//         v1.0 (UK-STABLE)
//       </Animated.Text>
//     </View>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: "#FFFFFF",
//     justifyContent: "center",
//     alignItems: "center",
//   },

//   // Logo
//   logoContainer: {
//     alignItems: "center",
//     marginBottom: 32,
//   },
//   logoMark: {
//     width: 100,
//     height: 100,
//     justifyContent: "center",
//     alignItems: "center",
//     position: "relative",
//   },
//   logoInner: {
//     width: 80,
//     height: 80,
//     borderRadius: 20,
//     backgroundColor: SECONDARY,
//     justifyContent: "center",
//     alignItems: "center",
//     shadowColor: SECONDARY,
//     shadowOffset: { width: 0, height: 8 },
//     shadowOpacity: 0.25,
//     shadowRadius: 16,
//     elevation: 8,
//   },
//   logoLetter: {
//     fontSize: 42,
//     fontWeight: "800",
//     color: "#FFFFFF",
//     letterSpacing: -1,
//   },

//   // Route decoration
//   routeLine: {
//     position: "absolute",
//     bottom: -8,
//     width: 60,
//     height: 3,
//     backgroundColor: PRIMARY,
//     borderRadius: 2,
//     opacity: 0.8,
//   },
//   routeDot: {
//     position: "absolute",
//     bottom: -10,
//     width: 8,
//     height: 8,
//     borderRadius: 4,
//     backgroundColor: PRIMARY,
//   },
//   routeDotStart: {
//     left: 12,
//   },
//   routeDotEnd: {
//     right: 12,
//     backgroundColor: SECONDARY,
//   },

//   // Brand Name
//   brandContainer: {
//     alignItems: "center",
//   },
//   brandName: {
//     fontSize: 32,
//     fontWeight: "700",
//     color: SECONDARY,
//     letterSpacing: -0.5,
//   },
//   brandNameHighlight: {
//     color: PRIMARY,
//   },
//   tagline: {
//     fontSize: 14,
//     color: "#888888",
//     marginTop: 8,
//     letterSpacing: 0.5,
//     fontWeight: "400",
//   },

//   // Loader
//   loaderContainer: {
//     position: "absolute",
//     bottom: 120,
//     alignItems: "center",
//     width: 200,
//   },
//   loaderTrack: {
//     width: 120,
//     height: 3,
//     backgroundColor: "#F0F0F0",
//     borderRadius: 2,
//     overflow: "hidden",
//     marginBottom: 12,
//   },
//   loaderFill: {
//     width: "100%",
//     height: "100%",
//     backgroundColor: PRIMARY,
//     borderRadius: 2,
//   },
//   loaderText: {
//     fontSize: 12,
//     color: "#AAAAAA",
//     letterSpacing: 1,
//     textTransform: "uppercase",
//   },

//   // Version
//   versionText: {
//     position: "absolute",
//     bottom: 40,
//     fontSize: 11,
//     color: "#CCCCCC",
//     letterSpacing: 0.5,
//   },
// });

import React from "react";
import { View, StyleSheet, Image, Dimensions } from "react-native";

const { width, height } = Dimensions.get("window");

export default function SplashScreen() {
  return ( 
    <View style={styles.container}>
      <Image
        source={require("../assets/splash-icon.png")} // Change to your image path
        style={styles.image}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
  },
  image: {
    width: width,
    height: height,
  },
});