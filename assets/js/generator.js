(() => {
  'use strict';

  const app = window.LoopSmith;
  const { steps, stepsPerBar } = app.constants;
  const { motifLibrary, progressionBank, scales, variationProfiles } = app.catalog;

  const clampDegree = (value, scaleLength) => Math.max(0, Math.min(scaleLength - 1, value));

  function smoothPhrase(notes, scaleLength) {
    const result = notes.map((note) => clampDegree(note, scaleLength));

    for (let index = 1; index < result.length; index += 1) {
      const leap = result[index] - result[index - 1];
      if (Math.abs(leap) > 3) {
        result[index] = clampDegree(result[index - 1] + Math.sign(leap) * 2, scaleLength);
      }
    }

    return result;
  }

  function varyPhrase(source, random, scaleLength, changes = 2, transpose = 0) {
    const result = source.map((note) => clampDegree(note + transpose, scaleLength));
    const availablePositions = Array.from({ length: result.length - 2 }, (_, index) => index + 1);

    // Sampling without replacement guarantees bounded work and keeps each variation legible.
    for (let index = availablePositions.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [availablePositions[index], availablePositions[swapIndex]] = [availablePositions[swapIndex], availablePositions[index]];
    }

    availablePositions.slice(0, Math.min(changes, availablePositions.length)).forEach((position) => {
      const direction = random() < 0.5 ? -1 : 1;
      const distance = random() < 0.82 ? 1 : 2;
      result[position] = clampDegree(result[position] + direction * distance, scaleLength);
    });

    // A downward or level phrase ending reads as a cadence without forcing every
    // generated line to resolve in exactly the same way.
    if (random() < 0.7) {
      result[result.length - 1] = clampDegree(Math.min(result[result.length - 2], result[result.length - 1]), scaleLength);
    }

    return smoothPhrase(result, scaleLength);
  }

  function applyMusicalRests(notes, density, random) {
    const result = [...notes];
    const desiredActiveNotes = Math.max(28, Math.min(steps, Math.round(steps * density / 100)));
    const targetRestCount = steps - desiredActiveNotes;
    const candidateGroups = [];

    // Weak positions are considered in musical priority order. Downbeats and the
    // four-step coda remain intact, and a bar never receives more than one rest.
    [3, 1, 2].forEach((position) => {
      const group = [];
      for (let bar = 0; bar < steps / stepsPerBar; bar += 1) {
        const step = bar * stepsPerBar + position;
        if (step < steps - stepsPerBar) group.push(step);
      }

      for (let index = group.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(random() * (index + 1));
        [group[index], group[swapIndex]] = [group[swapIndex], group[index]];
      }
      candidateGroups.push(group);
    });

    let restCount = 0;
    for (const step of candidateGroups.flat()) {
      if (restCount >= targetRestCount) break;

      const barStart = Math.floor(step / stepsPerBar) * stepsPerBar;
      const barHasRest = result.slice(barStart, barStart + stepsPerBar).some((note) => note === null);
      const touchesRest = result[step - 1] === null || result[step + 1] === null;
      if (barHasRest || touchesRest) continue;

      result[step] = null;
      restCount += 1;
    }

    return result;
  }

  function validateMelody(notes, scaleLength) {
    if (!Array.isArray(notes) || notes.length !== steps) return false;

    return notes.every((note, index) => {
      const isValidDegree = note === null || (Number.isInteger(note) && note >= 0 && note < scaleLength);
      const protectedStep = index % stepsPerBar === 0 || index >= steps - stepsPerBar;
      return isValidDegree && (!protectedStep || note !== null);
    }) && Array.from({ length: steps / stepsPerBar }, (_, bar) => (
      notes.slice(bar * stepsPerBar, bar * stepsPerBar + stepsPerBar).filter((note) => note === null).length <= 1
    )).every(Boolean);
  }

  function composeMelody(settings) {
    const random = app.math.rngFrom(`${settings.seed}-motif-engine-v3`);
    const scaleLength = scales[settings.scale].semitones.length;
    const motif = motifLibrary[Math.floor(random() * motifLibrary.length)];
    let phraseA = motif.notes.map((note) => clampDegree(note, scaleLength));

    if (random() < 0.42) {
      const shift = random() < 0.72 ? 1 : -1;
      phraseA = phraseA.map((note) => clampDegree(note + shift, scaleLength));
    }

    if (random() < 0.18) {
      const low = Math.min(...phraseA);
      const high = Math.max(...phraseA);
      phraseA = phraseA.map((note) => clampDegree(high - (note - low), scaleLength));
    }

    phraseA = smoothPhrase(phraseA, scaleLength);
    const phraseA1 = varyPhrase(phraseA, random, scaleLength, 2, random() < 0.22 ? 1 : 0);
    let phraseB;

    if (random() < 0.42) {
      const secondMotif = motifLibrary[Math.floor(random() * motifLibrary.length)].notes;
      phraseB = smoothPhrase(secondMotif.map((note) => clampDegree(note + (random() < 0.5 ? 0 : 1), scaleLength)), scaleLength);
    } else {
      phraseB = varyPhrase(phraseA, random, scaleLength, 3, random() < 0.5 ? 1 : -1);
    }

    const phraseA2 = varyPhrase(phraseA, random, scaleLength, 2);
    const phraseB1 = varyPhrase(phraseB, random, scaleLength, 2);
    const structures = [
      { name: 'A A′ B A″ + coda', phrases: [phraseA, phraseA1, phraseB, phraseA2] },
      { name: 'A B A′ B′ + coda', phrases: [phraseA, phraseB, phraseA1, phraseB1] },
      { name: 'A A′ A″ B + coda', phrases: [phraseA, phraseA1, phraseA2, phraseB] },
      { name: 'A B B′ A′ + coda', phrases: [phraseA, phraseB, phraseB1, phraseA1] }
    ];
    const structure = structures[Math.floor(random() * structures.length)];
    const cadenceSource = random() < 0.68 ? phraseA2 : phraseB1;
    const cadence = [cadenceSource[4], cadenceSource[5], random() < 0.55 ? 1 : 2, 0]
      .map((note) => clampDegree(note, scaleLength));
    const completePhrase = structure.phrases.flat().concat(cadence).slice(0, steps);
    const notes = applyMusicalRests(completePhrase, settings.density, random);

    if (!validateMelody(notes, scaleLength)) {
      throw new Error('Generated melody failed its structural invariants.');
    }

    return { notes, motifName: motif.name, structure: structure.name };
  }

  function variedInteger(random, range, previous, minimumDelta) {
    for (let attempt = 0; attempt < 18; attempt += 1) {
      const value = Math.round(range[0] + random() * (range[1] - range[0]));
      if (value !== previous && Math.abs(value - previous) >= minimumDelta) return value;
    }

    return Math.abs(previous - range[0]) > Math.abs(previous - range[1]) ? range[0] : range[1];
  }

  function createFullVariation(previousSettings, currentProfileKey, currentProgression) {
    const profileKeys = Object.keys(variationProfiles).filter((key) => key !== currentProfileKey);
    const entropy = `${Date.now()}-${app.math.entropyToken()}-${previousSettings.seed}`;
    const selectionRandom = app.math.rngFrom(entropy);
    const profileKey = profileKeys[Math.floor(selectionRandom() * profileKeys.length)];
    const profile = variationProfiles[profileKey];
    const seed = `${profileKey}-${app.math.entropyToken()}`;
    const random = app.math.rngFrom(seed);
    const pick = (values) => values[Math.floor(random() * values.length)];

    let progressionIndex = Math.floor(random() * progressionBank.length);
    while (progressionBank[progressionIndex].join(',') === currentProgression.join(',')) {
      progressionIndex = (progressionIndex + 1) % progressionBank.length;
    }

    return {
      profileKey,
      profileLabel: profile.label,
      seed,
      root: (previousSettings.root + 1 + Math.floor(random() * 11)) % 12,
      scale: pick(profile.scales),
      bpm: variedInteger(random, profile.bpm, previousSettings.bpm, 7),
      energy: variedInteger(random, profile.energy, previousSettings.energy, 10),
      density: variedInteger(random, profile.density, previousSettings.density, 6),
      brightness: variedInteger(random, profile.brightness, previousSettings.brightness, 12),
      space: variedInteger(random, profile.space, previousSettings.space, 12),
      swing: variedInteger(random, profile.swing, previousSettings.swing, 3),
      pad: pick(profile.pad),
      drums: pick(profile.drums),
      voiceStyle: pick(profile.voices),
      progression: [...progressionBank[progressionIndex]]
    };
  }

  app.generator = {
    applyMusicalRests,
    composeMelody,
    createFullVariation,
    validateMelody
  };
})();
