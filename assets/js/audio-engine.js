(() => {
  'use strict';

  const app = window.LoopSmith;
  const audio = app.audioState;
  const { harmonySteps, steps, stepsPerBar } = app.constants;
  const { scales, voiceStyles } = app.catalog;

  function makeImpulse(context, seconds, decay, seed = 'room') {
    const length = Math.floor(context.sampleRate * seconds);
    const buffer = context.createBuffer(2, length, context.sampleRate);
    const random = app.math.rngFrom(seed);

    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < length; index += 1) {
        data[index] = (random() * 2 - 1) * Math.pow(1 - index / length, decay);
      }
    }

    return buffer;
  }

  function createGraph(context, settings, withAnalyser = false) {
    const mix = context.createGain();
    const filter = context.createBiquadFilter();
    const dry = context.createGain();
    const convolver = context.createConvolver();
    const wet = context.createGain();
    const master = context.createGain();
    const limiter = context.createDynamicsCompressor();

    filter.type = 'lowpass';
    filter.frequency.value = 900 + settings.brightness * 55;
    filter.Q.value = 0.35;
    dry.gain.value = 0.94;
    wet.gain.value = settings.space / 100 * 0.42;
    master.gain.value = 0.62;
    // A stable room impulse keeps live playback and offline exports identical even
    // when the user changes seeds after the real-time AudioContext already exists.
    convolver.buffer = makeImpulse(context, 1.7, 2.7, 'loopsmith-room-v1');

    // The compressor acts as a transparent safety ceiling when dense melodies,
    // bass, pads, and sound effects overlap at high energy settings.
    limiter.threshold.value = -14;
    limiter.knee.value = 18;
    limiter.ratio.value = 4;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;

    mix.connect(filter);
    filter.connect(dry);
    filter.connect(convolver);
    dry.connect(master);
    convolver.connect(wet);
    wet.connect(master);
    master.connect(limiter);

    let analyser = null;
    if (withAnalyser) {
      analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      limiter.connect(analyser);
      analyser.connect(context.destination);
    } else {
      limiter.connect(context.destination);
    }

    return { mix, filter, wet, master, limiter, analyser };
  }

  function trackSource(source, context) {
    if (context !== audio.context) return;

    audio.sources.add(source);
    source.addEventListener('ended', () => audio.sources.delete(source), { once: true });
  }

  function melodyVoice(context, destination, time, frequency, duration, amplitude, settings) {
    const gain = context.createGain();
    const oscillator = context.createOscillator();
    const harmonic = context.createOscillator();
    const harmonicGain = context.createGain();
    const style = voiceStyles[settings.voiceStyle] || voiceStyles.bell;
    const attack = 0.012;
    const release = Math.max(0.05, duration * 0.18);

    oscillator.type = style.primary;
    oscillator.frequency.value = frequency;
    harmonic.type = 'sine';
    harmonic.frequency.value = frequency * style.harmonicRatio;
    harmonicGain.gain.value = (0.1 + settings.brightness / 500) * style.harmonicGain;

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(amplitude, time + attack);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, amplitude * 0.35), time + duration * 0.55);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration + release);

    oscillator.connect(gain);
    harmonic.connect(harmonicGain);
    harmonicGain.connect(gain);
    gain.connect(destination);
    oscillator.start(time);
    harmonic.start(time);
    oscillator.stop(time + duration + release + 0.02);
    harmonic.stop(time + duration + release + 0.02);
    trackSource(oscillator, context);
    trackSource(harmonic, context);
  }

  function bassVoice(context, destination, time, frequency, duration, amplitude) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();

    oscillator.type = 'triangle';
    oscillator.frequency.value = frequency;
    filter.type = 'lowpass';
    filter.frequency.value = 520;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(amplitude, time + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.02);
    trackSource(oscillator, context);
  }

  function padVoice(context, destination, time, frequency, duration, amplitude) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amplitude, time + 0.3);
    gain.gain.setValueAtTime(amplitude, time + Math.max(0.31, duration - 0.45));
    gain.gain.linearRampToValueAtTime(0.0001, time + duration);

    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.02);
    trackSource(oscillator, context);
  }

  function kick(context, destination, time, amplitude) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.frequency.setValueAtTime(130, time);
    oscillator.frequency.exponentialRampToValueAtTime(48, time + 0.16);
    gain.gain.setValueAtTime(amplitude, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.19);
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start(time);
    oscillator.stop(time + 0.2);
    trackSource(oscillator, context);
  }

  function hat(context, destination, time, amplitude, seed) {
    const length = Math.floor(context.sampleRate * 0.045);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    const random = app.math.rngFrom(seed);
    const source = context.createBufferSource();
    const highPass = context.createBiquadFilter();
    const gain = context.createGain();

    for (let index = 0; index < length; index += 1) data[index] = random() * 2 - 1;

    source.buffer = buffer;
    highPass.type = 'highpass';
    highPass.frequency.value = 5200;
    gain.gain.setValueAtTime(amplitude, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
    source.connect(highPass);
    highPass.connect(gain);
    gain.connect(destination);
    source.start(time);
    trackSource(source, context);
  }

  function scheduleStep(context, graph, step, time, settings, repetition = 0) {
    const scale = scales[settings.scale].semitones;
    const section = Math.floor(step / harmonySteps);
    const chord = settings.progression[section % settings.progression.length];
    const energy = settings.energy / 100;
    const stepDuration = app.math.stepSeconds(settings);
    const degree = settings.melody[step];

    if (degree !== null && degree !== undefined) {
      const midi = 48 + settings.root + chord + scale[Math.min(degree, scale.length - 1)];
      melodyVoice(context, graph.mix, time, app.math.midiHz(midi), stepDuration * (2.75 + energy * 0.95), 0.082 + energy * 0.072, settings);
    }

    if (step % harmonySteps === 0) {
      const bassMidi = 36 + settings.root + chord;
      bassVoice(context, graph.mix, time, app.math.midiHz(bassMidi), stepDuration * 6.4, 0.075 + energy * 0.052);
      if (settings.pad) {
        [0, 2, 4].forEach((degreeIndex) => {
          if (scale[degreeIndex] !== undefined) {
            padVoice(context, graph.mix, time, app.math.midiHz(48 + settings.root + chord + scale[degreeIndex]), stepDuration * 7.7, 0.014 + energy * 0.01);
          }
        });
      }
    }

    if (settings.drums && step % stepsPerBar === 0) kick(context, graph.mix, time, 0.09 + energy * 0.09);
    if (settings.drums && step % 2 === 1) hat(context, graph.mix, time, 0.018 + energy * 0.018, `${settings.seed}-${step}-${repetition}`);
  }

  async function ensureAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('This browser does not support the Web Audio API.');

    if (!audio.context) {
      audio.context = new AudioContextClass();
      audio.graph = createGraph(audio.context, app.readSettings(), true);
    }

    if (audio.context.state === 'suspended') await audio.context.resume();
  }

  function updateGraph() {
    if (!audio.graph || !audio.context) return;

    const settings = app.readSettings();
    const now = audio.context.currentTime;
    audio.graph.filter.frequency.setTargetAtTime(900 + settings.brightness * 55, now, 0.04);
    audio.graph.wet.gain.setTargetAtTime(settings.space / 100 * 0.42, now, 0.04);
  }

  function scheduleVisualStep(step, scheduledTime) {
    const delay = Math.max(0, (scheduledTime - audio.context.currentTime) * 1000);
    const timer = window.setTimeout(() => {
      audio.visualTimers.delete(timer);
      if (audio.playing) app.ui.showPlayhead(step);
    }, delay);
    audio.visualTimers.add(timer);
  }

  function scheduler() {
    if (!audio.playing || !audio.context) return;

    const lookAhead = 0.12;
    while (audio.nextStepTime < audio.context.currentTime + lookAhead) {
      const settings = app.readSettings();
      const stepDuration = app.math.stepSeconds(settings);
      const swingOffset = audio.step % 2 ? stepDuration * (settings.swing / 100) * 0.45 : 0;
      const scheduledTime = audio.nextStepTime + swingOffset;

      scheduleStep(audio.context, audio.graph, audio.step, scheduledTime, settings);
      scheduleVisualStep(audio.step, scheduledTime);
      audio.nextStepTime += stepDuration;
      audio.step = (audio.step + 1) % steps;
    }
  }

  async function startPlayback() {
    await ensureAudio();
    audio.playing = true;
    audio.step = 0;
    audio.nextStepTime = audio.context.currentTime + 0.06;
    scheduler();
    audio.schedulerTimer = window.setInterval(scheduler, 25);
    app.ui.setPlaybackState(true);
  }

  function stopPlayback() {
    audio.playing = false;
    window.clearInterval(audio.schedulerTimer);
    audio.schedulerTimer = null;
    audio.visualTimers.forEach((timer) => window.clearTimeout(timer));
    audio.visualTimers.clear();
    audio.sources.forEach((source) => {
      try { source.stop(); } catch (_) { /* The node may already have ended naturally. */ }
    });
    audio.sources.clear();
    app.ui.clearPlayhead();
    app.ui.setPlaybackState(false);
  }

  async function togglePlayback() {
    if (audio.playing) {
      stopPlayback();
      return;
    }

    try {
      await startPlayback();
    } catch (error) {
      console.error(error);
      app.ui.reportAudioError(error.message);
    }
  }

  async function playSfx(kind) {
    try {
      await ensureAudio();
      const time = audio.context.currentTime + 0.02;
      const destination = audio.graph.mix;
      const settings = app.readSettings();
      const ping = (frequency, duration, amplitude, delay = 0) => (
        melodyVoice(audio.context, destination, time + delay, frequency, duration, amplitude, { ...settings, brightness: 55 })
      );

      if (kind === 'tap') ping(560, 0.09, 0.16);
      if (kind === 'move') ping(440, 0.11, 0.18);
      if (kind === 'deny') bassVoice(audio.context, destination, time, 180, 0.16, 0.2);
      if (kind === 'coin') { ping(880, 0.1, 0.16); ping(1320, 0.14, 0.13, 0.07); }
      if (kind === 'win') [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => ping(frequency, 0.32, 0.15, index * 0.09));
    } catch (error) {
      console.error(error);
      app.ui.reportAudioError(error.message);
    }
  }

  async function dispose() {
    if (!audio.context) return;
    stopPlayback();
    await audio.context.close().catch(() => {});
    audio.context = null;
    audio.graph = null;
  }

  app.audioEngine = {
    createGraph,
    dispose,
    ensureAudio,
    playSfx,
    scheduleStep,
    stopPlayback,
    togglePlayback,
    updateGraph
  };
})();
