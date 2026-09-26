(() => {
  'use strict';

  const app = window.LoopSmith;
  const { harmonySteps, steps, stepsPerBar } = app.constants;
  const { noteNames, scales } = app.catalog;
  const gridCells = Array.from({ length: steps }, () => []);
  let playingStep = -1;

  function updateGridStep(step) {
    gridCells[step].forEach((cell, degree) => {
      const active = app.state.melody[step] === degree;
      cell.classList.toggle('active', active);
      cell.setAttribute('aria-pressed', String(active));
    });
  }

  function updateGrid() {
    for (let step = 0; step < steps; step += 1) updateGridStep(step);
  }

  function renderGrid() {
    const grid = app.$('stepGrid');
    const scale = scales[app.$('scale').value].semitones;
    const fragment = document.createDocumentFragment();

    grid.replaceChildren();
    gridCells.forEach((cells) => cells.splice(0));

    for (let row = scale.length - 1; row >= 0; row -= 1) {
      const label = document.createElement('div');
      label.className = 'degree-label';
      label.textContent = row + 1;
      fragment.appendChild(label);

      for (let step = 0; step < steps; step += 1) {
        const cell = document.createElement('button');
        const title = `Step ${step + 1}, scale degree ${row + 1}`;
        cell.type = 'button';
        cell.className = `step-cell${step % stepsPerBar === 0 ? ' beat' : ''}`;
        cell.title = title;
        cell.setAttribute('aria-label', title);
        cell.addEventListener('click', () => {
          app.state.melody[step] = app.state.melody[step] === row ? null : row;
          updateGridStep(step);
          updateOutputs();
        });
        gridCells[step][row] = cell;
        fragment.appendChild(cell);
      }
    }

    grid.appendChild(fragment);
    updateGrid();

    const numberFragment = document.createDocumentFragment();
    numberFragment.appendChild(document.createElement('span'));
    for (let step = 0; step < steps; step += 1) {
      const number = document.createElement('span');
      number.textContent = step + 1;
      numberFragment.appendChild(number);
    }
    app.$('beatNumbers').replaceChildren(numberFragment);
  }

  function clearPlayhead() {
    if (playingStep >= 0) gridCells[playingStep].forEach((cell) => cell.classList.remove('playing'));
    playingStep = -1;
    app.$('nowPlaying').textContent = '—';
    app.$('transportTime').textContent = `Bar 1/${steps / stepsPerBar} · Step 1/${steps}`;
  }

  function showPlayhead(step) {
    if (playingStep >= 0) gridCells[playingStep].forEach((cell) => cell.classList.remove('playing'));
    playingStep = step;
    gridCells[step].forEach((cell) => cell.classList.add('playing'));

    const bar = Math.floor(step / stepsPerBar) + 1;
    const degree = app.state.melody[step];
    const settings = app.readSettings();
    app.$('transportTime').textContent = `Bar ${bar}/${steps / stepsPerBar} · Step ${step + 1}/${steps}`;

    if (degree === null || degree === undefined) {
      app.$('nowPlaying').textContent = 'rest';
      return;
    }

    const progression = settings.progression[Math.floor(step / harmonySteps) % settings.progression.length];
    const midi = 48 + settings.root + progression + scales[settings.scale].semitones[degree];
    app.$('nowPlaying').textContent = noteNames[((midi % 12) + 12) % 12];
  }

  function setPlaybackState(playing) {
    app.$('playIcon').textContent = playing ? '■' : '▶';
    app.$('playText').textContent = playing ? 'Stop' : 'Play';
    app.$('audioStatus').textContent = playing ? 'Playing' : 'Ready';
    app.$('audioStatus').closest('.status').classList.remove('is-error');
  }

  function reportAudioError(message) {
    const status = app.$('audioStatus');
    status.textContent = 'Audio unavailable';
    status.closest('.status').classList.add('is-error');
    toast(message || 'Audio is unavailable');
  }

  function setExportState(rendering) {
    const button = app.$('exportWav');
    button.disabled = rendering;
    button.textContent = rendering ? 'Rendering…' : 'Export WAV';
  }

  function updateOutputs() {
    const settings = app.readSettings();
    ['bpm', 'energy', 'density', 'brightness', 'space', 'swing'].forEach((key) => {
      app.$(`${key}Out`).textContent = key === 'bpm' ? `${settings[key]} BPM` : `${settings[key]}%`;
    });

    app.$('metaKey').textContent = `${noteNames[settings.root]} ${scales[settings.scale].short}`;
    app.$('metaLoop').textContent = `${app.math.loopSeconds(settings).toFixed(1)} s`;
    app.$('metaProfile').textContent = app.state.profileLabel;
    app.$('melodyDetails').textContent = `${settings.motifName} · ${settings.melody.filter((note) => note !== null).length}/${steps} notes · ${settings.structure}`;

    const output = app.state.currentTab === 'prompt'
      ? app.exporter.buildPrompt()
      : app.state.currentTab === 'json'
        ? JSON.stringify(app.exporter.buildSpec(), null, 2)
        : app.exporter.buildGodot();
    app.$('handoffText').value = output;
    app.audioEngine.updateGraph();
  }

  function toast(message) {
    const element = app.$('toast');
    element.textContent = message;
    element.classList.add('show');
    window.clearTimeout(element._hideTimer);
    element._hideTimer = window.setTimeout(() => element.classList.remove('show'), 1800);
  }

  function drawScope() {
    const canvas = app.$('scope');
    const context = canvas.getContext('2d');
    if (!context) return;

    const samples = new Uint8Array(1024);
    const frame = () => {
      const rect = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rect.width * pixelRatio));
      const height = Math.max(1, Math.round(rect.height * pixelRatio));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      context.strokeStyle = 'rgba(255, 255, 255, 0.055)';
      context.lineWidth = 1;

      for (let x = 0; x < rect.width; x += rect.width / steps) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, rect.height);
        context.stroke();
      }

      const analyser = app.audioState.graph?.analyser;
      if (analyser) analyser.getByteTimeDomainData(samples);
      else samples.fill(128);

      context.beginPath();
      context.lineWidth = 2.2;
      context.strokeStyle = app.audioState.playing ? '#d8ff62' : '#5c5d68';
      for (let index = 0; index < samples.length; index += 1) {
        const x = index / (samples.length - 1) * rect.width;
        const normalized = (samples[index] - 128) / 128;
        const y = rect.height / 2 + normalized * rect.height * 1.28;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
      window.requestAnimationFrame(frame);
    };

    window.requestAnimationFrame(frame);
  }

  app.ui = {
    clearPlayhead,
    drawScope,
    renderGrid,
    reportAudioError,
    setExportState,
    setPlaybackState,
    showPlayhead,
    toast,
    updateGrid,
    updateOutputs
  };
})();
