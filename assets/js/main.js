(() => {
  'use strict';

  const app = window.LoopSmith;
  const { presets, presetLabels } = app.catalog;

  function generateMelody(forceGenerated = false) {
    const settings = app.readSettings();
    const preset = presets[app.$('preset').value];

    if (!forceGenerated && preset?.fixed && settings.seed === preset.seed) {
      app.state.melody = Array.from({ length: app.constants.steps }, (_, index) => preset.fixed[index % preset.fixed.length]);
      app.state.motifName = 'Game Arc';
      app.state.structure = 'Original repeating theme';
    } else {
      const composition = app.generator.composeMelody(settings);
      app.state.melody = composition.notes;
      app.state.motifName = composition.motifName;
      app.state.structure = composition.structure;
    }

    app.ui.renderGrid();
    app.ui.updateOutputs();
  }

  function applyPreset(name) {
    const preset = presets[name];
    if (!preset) return;

    app.$('seed').value = preset.seed;
    app.$('root').value = preset.root;
    app.$('scale').value = preset.scale;
    app.$('bpm').value = preset.bpm;
    app.$('energy').value = preset.energy;
    app.$('density').value = preset.density;
    app.$('brightness').value = preset.brightness;
    app.$('space').value = preset.space;
    app.$('swing').value = preset.swing;
    app.$('pad').checked = preset.pad;
    app.$('drums').checked = preset.drums;
    app.state.progression = [...preset.progression];
    app.state.profileKey = name;
    app.state.profileLabel = presetLabels[name] || 'Preset';
    app.state.voiceStyle = preset.voiceStyle || 'bell';
    generateMelody();
  }

  function applyVariation(variation) {
    app.$('preset').value = 'random';
    app.$('seed').value = variation.seed;
    app.$('root').value = variation.root;
    app.$('scale').value = variation.scale;
    app.$('bpm').value = variation.bpm;
    app.$('energy').value = variation.energy;
    app.$('density').value = variation.density;
    app.$('brightness').value = variation.brightness;
    app.$('space').value = variation.space;
    app.$('swing').value = variation.swing;
    app.$('pad').checked = variation.pad;
    app.$('drums').checked = variation.drums;
    app.state.voiceStyle = variation.voiceStyle;
    app.state.progression = variation.progression;
    app.state.profileKey = variation.profileKey;
    app.state.profileLabel = variation.profileLabel;
  }

  function generateFullVariation() {
    const previousSettings = app.readSettings();
    const wasPlaying = app.audioState.playing;
    if (wasPlaying) app.audioEngine.stopPlayback();

    const variation = app.generator.createFullVariation(previousSettings, app.state.profileKey, app.state.progression);
    applyVariation(variation);
    generateMelody(true);
    app.ui.toast(`New character: ${variation.profileLabel}`);

    if (wasPlaying) window.setTimeout(() => app.audioEngine.togglePlayback(), 70);
  }

  async function copyHandoff() {
    const textArea = app.$('handoffText');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(textArea.value);
    } catch (_) {
      textArea.focus();
      textArea.select();
      const copied = document.execCommand('copy');
      if (!copied) {
        app.ui.toast('Select the handoff text and copy it manually');
        return;
      }
    }
    app.ui.toast('Handoff copied');
  }

  function bindEvents() {
    app.$('preset').addEventListener('change', (event) => {
      if (event.target.value === 'random') generateFullVariation();
      else applyPreset(event.target.value);
    });
    app.$('newSeed').addEventListener('click', generateFullVariation);
    app.$('generate').addEventListener('click', generateFullVariation);
    app.$('seed').addEventListener('change', () => generateMelody(true));

    app.controlIds.forEach((id) => {
      app.$(id).addEventListener('input', () => {
        if (id !== 'scale') app.ui.updateOutputs();
      });
    });
    app.$('scale').addEventListener('change', () => generateMelody(true));
    app.$('density').addEventListener('change', () => generateMelody(true));

    app.$('play').addEventListener('click', app.audioEngine.togglePlayback);
    app.$('exportWav').addEventListener('click', app.exporter.exportWav);
    document.querySelectorAll('[data-sfx]').forEach((button) => {
      button.addEventListener('click', () => app.audioEngine.playSfx(button.dataset.sfx));
    });

    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((item) => {
          item.classList.toggle('active', item === tab);
          item.setAttribute('aria-selected', String(item === tab));
        });
        app.state.currentTab = tab.dataset.tab;
        app.ui.updateOutputs();
      });
    });

    app.$('copyHandoff').addEventListener('click', copyHandoff);
    app.$('downloadSpec').addEventListener('click', app.exporter.downloadSpec);
    app.$('handoffToggle').addEventListener('click', () => {
      const panel = document.querySelector('.handoff');
      const collapsed = panel.classList.toggle('collapsed');
      app.$('handoffToggle').setAttribute('aria-expanded', String(!collapsed));
      app.$('handoffToggle').textContent = collapsed ? 'Expand' : 'Collapse';
    });

    window.addEventListener('keydown', (event) => {
      const activeTag = document.activeElement?.tagName || '';
      if (event.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(activeTag)) {
        event.preventDefault();
        app.audioEngine.togglePlayback();
      }
    });
    window.addEventListener('pagehide', () => app.audioEngine.dispose(), { once: true });
  }

  function initialize() {
    bindEvents();
    applyPreset('original');
    app.ui.drawScope();

    if (!(window.AudioContext || window.webkitAudioContext)) {
      app.$('play').disabled = true;
      app.$('audioStatus').textContent = 'Web Audio unsupported';
      app.$('audioStatus').closest('.status').classList.add('is-error');
    }
  }

  initialize();
})();
