// @stripe/stripe-react-native 0.50.x forward-declares STPPaymentStatus as NSUInteger in
// ios/StripeSwiftInterop.h, but the Swift enum is Int (NSInteger). Xcode 26+ clang refuses
// the mismatch, so StripeSdk.mm fails to compile. Run after npm install, before pod install.
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'node_modules/@stripe/stripe-react-native/ios/StripeSwiftInterop.h';
const from = 'typedef NS_ENUM(NSUInteger, STPPaymentStatus);';
const to = 'typedef NS_ENUM(NSInteger, STPPaymentStatus);';
const src = readFileSync(path, 'utf8');
if (src.includes(to)) {
  console.log('Stripe iOS header already patched');
} else if (src.includes(from)) {
  writeFileSync(path, src.replace(from, to));
  console.log('Patched STPPaymentStatus to NSInteger in', path);
} else {
  throw new Error(`Expected "${from}" in ${path}; check the Stripe version before building`);
}
