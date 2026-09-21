// A self-contained two-tone "ding" via the Web Audio API instead of bundling
// an audio file — no asset to fetch/cache, and it can't ever 404. Browsers
// block audio before any user gesture on the page, but by the time a real
// notification arrives the user has almost always already clicked/typed
// something, so this reliably plays. One shared AudioContext, created lazily
// on first use (constructing it before any user gesture can throw in some
// browsers) and reused after that.
let audioCtx = null;

export function playNotificationSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const now = audioCtx.currentTime;
    const playTone = (freq, start, duration, peakGain) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      // Quick linear attack then an exponential decay — a soft "ding" instead
      // of an abrupt on/off click.
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(peakGain, now + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + start);
      osc.stop(now + start + duration);
    };
    // Two overlapping notes, second one slightly delayed and quieter — reads
    // as a friendly "ding-dong" chime rather than a harsh single beep.
    playTone(880, 0, 0.18, 0.18);
    playTone(1320, 0.08, 0.22, 0.14);
  } catch (err) {
    // Silent — some browsers block audio entirely before any user
    // interaction on the page; a failed notification sound should never
    // break the notification itself.
  }
}
