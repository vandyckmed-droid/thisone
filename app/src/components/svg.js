/**
 * The single door to react-native-svg.
 *
 * Importing the package directly from more than one module makes the bundler
 * emit one import statement per module, and Snack's runtime evaluates the
 * package once for each of them. react-native-svg registers native views at
 * module scope, so the second evaluation throws
 *
 *     Invariant Violation: Tried to register two views with the same name
 *     RNSVGCircle
 *
 * and the app dies after it has already started rendering. Re-exporting from
 * here means the bundle contains exactly one import of the package however
 * many components draw with it.
 */
export {
  default as Svg,
  Circle,
  Defs,
  Line,
  LinearGradient,
  Path,
  Polyline,
  Rect,
  Stop,
} from 'react-native-svg';
