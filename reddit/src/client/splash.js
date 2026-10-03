// Inline post card: one trusted click opens the game in expanded mode.
import { requestExpandedMode } from '@devvit/web/client';

const button = document.getElementById('play');
if (button) {
  button.addEventListener('click', (ev) => requestExpandedMode(ev, 'game'));
}
