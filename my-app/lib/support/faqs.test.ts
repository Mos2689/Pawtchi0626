import { FAQS, visibleFaqs } from './faqs';
import { WALK_TRACKING_ENABLED } from '../../constants/features';

describe('the catalogue', () => {
  test('ids are unique — they are the analytics key and a future remote key', () => {
    const ids = FAQS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every entry has a real question and answer', () => {
    for (const f of FAQS) {
      expect(f.question.trim().length).toBeGreaterThan(10);
      expect(f.answer.trim().length).toBeGreaterThan(40);
    }
  });

  /**
   * Entries are either questions ("How do I cancel…?") or first-person symptom
   * statements ("I am not getting notifications"). The second form is
   * deliberate: people scan an FAQ for the thing happening to them, not for a
   * grammatically well-formed question, and rewriting a symptom into a question
   * ("Why are notifications not arriving?") makes it harder to spot, not easier.
   */
  test('each entry reads as a question or as a symptom the owner would recognise', () => {
    for (const f of FAQS) {
      const isQuestion = f.question.trim().endsWith('?');
      const isSymptom = /^I\b/.test(f.question.trim());
      expect({ id: f.id, ok: isQuestion || isSymptom }).toMatchObject({ ok: true });
    }
  });

  test('no exclamation marks anywhere — Copy Spec v1 §6.04', () => {
    for (const f of FAQS) {
      expect(f.question).not.toContain('!');
      expect(f.answer).not.toContain('!');
      expect(f.action?.label ?? '').not.toContain('!');
    }
  });

  test('never says "your pet" — the spec requires the animal be named', () => {
    for (const f of FAQS) {
      expect(`${f.question} ${f.answer}`.toLowerCase()).not.toContain('your pet');
    }
  });

  /**
   * The safety answer. Softening this into "Pawtchi can help diagnose…" would
   * be a clinical claim the product cannot support, so the shape of the answer
   * is pinned: it refuses, and it routes to a vet.
   */
  test('the vet answer refuses plainly and points at a vet', () => {
    const entry = FAQS.find((f) => f.id === 'not_a_vet');

    expect(entry).toBeDefined();
    expect(entry!.answer.startsWith('No.')).toBe(true);
    expect(entry!.answer).toContain('does not diagnose');
    expect(entry!.answer.toLowerCase()).toContain('vet');
  });
});

describe('visibility', () => {
  test('a cat owner is never shown the walks entry', () => {
    const ids = visibleFaqs({ species: 'cat', walkEnabled: false }).map((f) => f.id);

    expect(ids).not.toContain('where_are_walks');
  });

  test('an owner with no pet yet is never shown the walks entry', () => {
    const ids = visibleFaqs({ species: null, walkEnabled: false }).map((f) => f.id);

    expect(ids).not.toContain('where_are_walks');
  });

  test('a dog owner sees the walks entry only while tracking is switched off', () => {
    const ids = visibleFaqs({ species: 'dog', walkEnabled: WALK_TRACKING_ENABLED }).map((f) => f.id);

    // Explaining where walks went is only honest while they are actually gone.
    expect(ids.includes('where_are_walks')).toBe(!WALK_TRACKING_ENABLED);
  });

  test('the unconditional entries are shown to everyone', () => {
    const cat = visibleFaqs({ species: 'cat', walkEnabled: false }).map((f) => f.id);
    const dog = visibleFaqs({ species: 'dog', walkEnabled: true }).map((f) => f.id);

    for (const id of ['cancel_subscription', 'not_a_vet', 'delete_account', 'scan_accuracy']) {
      expect(cat).toContain(id);
      expect(dog).toContain(id);
    }
  });

  test('filtering preserves catalogue order', () => {
    const visible = visibleFaqs({ species: 'dog', walkEnabled: false }).map((f) => f.id);
    const expected = FAQS.filter((f) => visible.includes(f.id)).map((f) => f.id);

    expect(visible).toEqual(expected);
  });
});
