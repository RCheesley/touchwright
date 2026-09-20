/**
 * Entry point.
 *
 * A vertical slice, end to end: choose a layout export, see what the parser made
 * of it, see where those keys are, and type a drill on them. The ladder and
 * generated drill text come next, and both arrive through seams the drill surface
 * already has, so this file does not change when they land.
 */

import './ui/theme.css';
import { wireUp } from './ui/load-form.js';

wireUp();
