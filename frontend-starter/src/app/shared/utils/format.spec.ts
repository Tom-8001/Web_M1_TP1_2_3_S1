import { describe, expect, it } from 'vitest';
import { audioFormatLabel, formatBytes, formatDate } from './format';
import { MAX_AUDIO_SIZE, validateAudioFile } from './audio-file';

/** Tests des fonctions pures : entrées techniques, sorties lisibles. */
describe('format', () => {
  it('convertit une taille en unités lisibles', () => {
    expect(formatBytes(0)).toBe('0 o');
    expect(formatBytes(900)).toBe('900 o');
    expect(formatBytes(2048)).toBe('2.0 Ko');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 Mo');
  });

  it('affiche une date française et gère les dates invalides', () => {
    expect(formatDate('2026-01-02T10:00:00.000Z')).toContain('2026');
    expect(formatDate('pas-une-date')).toBe('date inconnue');
  });

  it('traduit les types MIME audio', () => {
    expect(audioFormatLabel('audio/mpeg')).toBe('MP3');
    expect(audioFormatLabel('audio/x-m4a')).toBe('M4A');
    expect(audioFormatLabel('audio/ogg')).toBe('OGG');
    expect(audioFormatLabel('')).toBe('audio');
  });
});

describe('validateAudioFile', () => {
  it('accepte un MP3 normal', () => {
    const file = new File(['audio'], 'morceau.mp3', { type: 'audio/mpeg' });
    expect(validateAudioFile(file)).toBeNull();
  });

  it('accepte un fichier dont le type MIME est vide mais l’extension connue', () => {
    const file = new File(['audio'], 'morceau.wav', { type: '' });
    expect(validateAudioFile(file)).toBeNull();
  });

  it('refuse un format non audio', () => {
    const file = new File(['texte'], 'notes.txt', { type: 'text/plain' });
    expect(validateAudioFile(file)).toContain('Format non accepté');
  });

  it('refuse un fichier de plus de 25 Mo', () => {
    const file = new File(['audio'], 'gros.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(file, 'size', { value: MAX_AUDIO_SIZE + 1 });

    expect(validateAudioFile(file)).toContain('trop volumineux');
  });

  it('refuse un fichier vide', () => {
    const file = new File([], 'vide.mp3', { type: 'audio/mpeg' });
    expect(validateAudioFile(file)).toContain('vide');
  });
});
