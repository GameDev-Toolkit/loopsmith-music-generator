(() => {
  'use strict';

  const app = window.LoopSmith;
  const { harmonySteps, steps, stepsPerBar } = app.constants;
  const { noteNames, scales, voiceStyles } = app.catalog;

  function encodeWav(buffer) {
    const channels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const dataLength = buffer.length * channels * 2;
    const arrayBuffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(arrayBuffer);
    const writeText = (offset, value) => {
      for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
    };

    writeText(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeText(8, 'WAVE');
    writeText(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    writeText(36, 'data');
    view.setUint32(40, dataLength, true);

    const channelData = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
    let offset = 44;
    for (let frame = 0; frame < buffer.length; frame += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const sample = Math.max(-1, Math.min(1, channelData[channel][frame]));
        view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
        offset += 2;
      }
    }

    return new Blob([view], { type: 'audio/wav' });
  }

  function downloadBlob(blob, name) {
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(anchor.href);
      anchor.remove();
    }, 1000);
  }

  function buildSpec() {
    const settings = app.readSettings();
    const scale = scales[settings.scale];
    const baseMidi = 48 + settings.root;
    const stepDuration = app.math.stepSeconds(settings);
    const loopDuration = app.math.loopSeconds(settings);
    const activeNotes = settings.melody.filter((note) => note !== null).length;
    const voiceStyle = voiceStyles[settings.voiceStyle];

    return {
      format: 'loopsmith-game-music-v1',
      generator_version: 3,
      seed: settings.seed,
      variation_profile: app.state.profileLabel,
      intended_engine: 'Godot 4 / AudioStreamGenerator',
      tempo: {
        bpm: settings.bpm,
        step_seconds: +stepDuration.toFixed(6),
        steps_per_loop: steps,
        steps_per_bar: stepsPerBar,
        bars_per_loop: steps / stepsPerBar,
        loop_seconds: +loopDuration.toFixed(3),
        swing_percent: settings.swing
      },
      harmony: {
        root_note: noteNames[settings.root],
        base_midi: baseMidi,
        base_hz: +app.math.midiHz(baseMidi).toFixed(3),
        scale: scale.short,
        scale_semitones: scale.semitones,
        progression_semitones: settings.progression,
        root_change_steps: harmonySteps
      },
      composition: {
        motif: settings.motifName,
        structure: settings.structure,
        active_notes: activeNotes,
        rests: settings.melody.length - activeNotes,
        realized_density_percent: +(activeNotes / steps * 100).toFixed(1)
      },
      melody: {
        degrees: settings.melody,
        frequencies_hz: settings.melody.map((degree, index) => {
          if (degree === null) return null;
          const chord = settings.progression[Math.floor(index / harmonySteps) % settings.progression.length];
          return +app.math.midiHz(baseMidi + chord + scale.semitones[degree]).toFixed(3);
        })
      },
      sound: {
        voice_style: settings.voiceStyle,
        wave_formula: 'primary(phase) + harmonic_mix * sin(phase * harmonic_ratio)',
        harmonic_ratio: voiceStyle.harmonicRatio,
        harmonic_mix: +((0.1 + settings.brightness / 500) * voiceStyle.harmonicGain).toFixed(3),
        attack_seconds: 0.012,
        note_duration_seconds: +(stepDuration * (2.75 + settings.energy / 100 * 0.95)).toFixed(3),
        brightness_percent: settings.brightness,
        reverb_percent: settings.space,
        output_limiter: true
      },
      arrangement: {
        bass: true,
        pad: settings.pad,
        soft_drums: settings.drums,
        energy_percent: settings.energy,
        requested_density_percent: settings.density
      },
      integration: {
        sample_rate_hz: 16000,
        music_bus: 'Music',
        preserve_sfx_bus: 'SFX',
        stereo_mode: 'dual_mono'
      }
    };
  }

  const godotArray = (values) => `[${values.map((value) => value === null ? '-1' : value).join(', ')}]`;

  function buildGodot() {
    const settings = app.readSettings();
    const spec = buildSpec();
    const scale = scales[settings.scale];

    return `# LoopSmith — Audio.gd handoff parameters
# Seed: ${settings.seed}
# Motif: ${settings.motifName}; structure: ${settings.structure}
# A PATTERN value of -1 represents a deliberate rest.

const RATE := 16000.0
const SCALE := ${godotArray(scale.semitones)}
const ROOTS := ${godotArray(settings.progression)}
const PATTERN := ${godotArray(settings.melody)}
const HARMONY_STEPS := ${harmonySteps}
const NOTE_LEN := ${spec.tempo.step_seconds}
const BASE_HZ := ${spec.harmony.base_hz}

const NOTE_DUR := ${spec.sound.note_duration_seconds}
const VOICE_STYLE := "${settings.voiceStyle}"
const HARMONIC_RATIO := ${spec.sound.harmonic_ratio}
const HARMONIC_MIX := ${spec.sound.harmonic_mix}
const ATTACK := 0.012
const BRIGHTNESS := ${settings.brightness / 100}
const REVERB_AMOUNT := ${settings.space / 100}
const SWING := ${settings.swing / 100}
const USE_PAD := ${settings.pad}
const USE_SOFT_DRUMS := ${settings.drums}

# Skip the melodic voice in _spawn_note() whenever degree < 0.
# Voice formula: primary(ph) + HARMONIC_MIX * sin(ph * HARMONIC_RATIO)`;
  }

  function buildPrompt() {
    const settings = app.readSettings();
    const spec = buildSpec();

    return `TASK: transfer this LoopSmith track into a Godot 4 game.

The project already synthesizes music in code with AudioStreamGenerator in scripts/Audio.gd. Do not add MP3, WAV, or OGG assets. Preserve the existing Music and SFX buses, volume controls, public tap/move/deny/coin/win methods, and headless-mode protection. Change only the music generator and the smallest necessary part of Audio.gd.

LOOP PARAMETERS
• Seed: ${settings.seed}
• Character: ${app.state.profileLabel}
• Motif: ${settings.motifName}
• Phrase structure: ${settings.structure}
• Active notes: ${spec.composition.active_notes}/${steps}; rests: ${spec.composition.rests}
• Tempo: ${settings.bpm} BPM; step interval: ${spec.tempo.step_seconds} seconds
• Root note: ${spec.harmony.root_note}; BASE_HZ: ${spec.harmony.base_hz} Hz
• Scale: ${scales[settings.scale].label}
• SCALE in semitones: ${godotArray(scales[settings.scale].semitones)}
• ROOTS, changed every ${harmonySteps} steps: ${godotArray(settings.progression)}
• ${steps}-step PATTERN: ${godotArray(settings.melody)}
• Melodic note duration: ${spec.sound.note_duration_seconds} seconds
• Voice style: ${settings.voiceStyle}
• Harmonic ratio: ${spec.sound.harmonic_ratio}; harmonic mix: ${spec.sound.harmonic_mix}
• Attack: 0.012 seconds
• Space / reverb: ${settings.space}%
• Swing: ${settings.swing}%
• Ambient pad: ${settings.pad ? 'enabled' : 'disabled'}
• Soft drums: ${settings.drums ? 'enabled' : 'disabled'}

IMPLEMENTATION REQUIREMENTS
1. Keep RATE = 16000 and continue filling PackedVector2Array with push_buffer.
2. Treat -1 in PATTERN as a rest: bass, pad, and drums continue, but do not create a melodic voice.
3. Calculate frequency as BASE_HZ * pow(2.0, float(root + SCALE[degree]) / 12.0).
4. Use the supplied primary waveform plus ${spec.sound.harmonic_mix} * sin(ph * ${spec.sound.harmonic_ratio}) for the melodic timbre, with a short attack and a smooth, click-free release.
5. Switch ROOTS every ${harmonySteps} steps and cycle with ROOTS[section % ROOTS.size()]. The full loop has ${steps} steps. Trigger the sustained bass at the same ${harmonySteps}-step interval.
6. Preserve the dense motif-based melody exactly as supplied. Do not randomly remove additional notes at runtime.
7. Do not break SFX or volume settings. If reverb, pad, or drums make real-time synthesis too expensive, implement melody and bass exactly first, then add the other layers economically without audio files.
8. Run the available Godot headless check after editing and briefly list the constants you changed.

Reference melodic frequencies by step (null means rest):
${JSON.stringify(spec.melody.frequencies_hz)}

Expected result: the in-game music matches this LoopSmith variation and loops without clicks, hangs, or leaked audio nodes.`;
  }

  async function exportWav() {
    const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineContext) {
      app.ui.toast('Offline WAV rendering is not supported');
      return;
    }

    const settings = app.readSettings();
    const sampleRate = 44100;
    const repeats = 2;
    const loopDuration = app.math.loopSeconds(settings);
    const duration = loopDuration * repeats + 2;
    const stepDuration = app.math.stepSeconds(settings);
    app.ui.setExportState(true);

    try {
      const offline = new OfflineContext(2, Math.ceil(sampleRate * duration), sampleRate);
      const graph = app.audioEngine.createGraph(offline, settings, false);

      for (let repetition = 0; repetition < repeats; repetition += 1) {
        for (let step = 0; step < steps; step += 1) {
          const swingOffset = step % 2 ? stepDuration * (settings.swing / 100) * 0.45 : 0;
          app.audioEngine.scheduleStep(offline, graph, step, repetition * loopDuration + step * stepDuration + swingOffset, settings, repetition);
        }
      }

      const rendered = await offline.startRendering();
      downloadBlob(encodeWav(rendered), `loopsmith-${app.math.safeFileName(settings.seed)}.wav`);
      app.ui.toast('WAV exported');
    } catch (error) {
      console.error(error);
      app.ui.toast('Could not export WAV');
    } finally {
      app.ui.setExportState(false);
    }
  }

  function downloadSpec() {
    const json = JSON.stringify(buildSpec(), null, 2);
    const name = `loopsmith-${app.math.safeFileName(app.$('seed').value)}.json`;
    downloadBlob(new Blob([json], { type: 'application/json' }), name);
  }

  app.exporter = {
    buildGodot,
    buildPrompt,
    buildSpec,
    downloadSpec,
    encodeWav,
    exportWav
  };
})();
