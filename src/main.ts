/**
 * Entry point.
 *
 * Currently a vertical slice: choose a layout export, see what the parser made of
 * it. The board render, the ladder and the drill come next; this exists so that
 * the parse path is exercised by the end-to-end suite from the start.
 */

import './ui/theme.css';
import { wireUp } from './ui/load-form.js';

wireUp();
