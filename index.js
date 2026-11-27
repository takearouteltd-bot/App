import { registerRootComponent } from 'expo';

// Before the app: Accept / Decline on job offer alerts, whose handlers must
// exist when Android starts the app in the background for a button press
// or an offer push (utils/offerAlerts.js).
import './utils/offerAlerts';
import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
