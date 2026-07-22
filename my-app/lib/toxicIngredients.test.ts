import { findToxicIngredients, hasToxicIngredients } from './toxicIngredients';

describe('toxicIngredients — acute toxin detection', () => {
  describe('Xylitol + synonyms', () => {
    test('plain "xylitol" matches', () => {
      const hits = findToxicIngredients('dog', ['Peanut butter (contains xylitol)']);
      expect(hits).toHaveLength(1);
      expect(hits[0].toxin).toBe('Xylitol');
    });

    test('"birch sugar" matches (xylitol synonym used to evade labels)', () => {
      const hits = findToxicIngredients('dog', ['Sugar-free gum with birch sugar']);
      expect(hits.some((h) => h.toxin === 'Xylitol')).toBe(true);
    });

    test('"E967" matches (European additive number)', () => {
      const hits = findToxicIngredients('dog', ['Sweetener E967']);
      expect(hits.some((h) => h.toxin === 'Xylitol')).toBe(true);
    });
  });

  describe('Chocolate', () => {
    test('"chocolate" matches', () => {
      const hits = findToxicIngredients('dog', ['Milk chocolate treat']);
      expect(hits.some((h) => h.toxin === 'Chocolate')).toBe(true);
    });

    test('"theobromine" matches', () => {
      const hits = findToxicIngredients('dog', ['Contains theobromine 0.5%']);
      expect(hits.some((h) => h.toxin === 'Chocolate')).toBe(true);
    });

    test('"cacao" matches', () => {
      const hits = findToxicIngredients('dog', ['Raw cacao nibs']);
      expect(hits.some((h) => h.toxin === 'Chocolate')).toBe(true);
    });

    test('false-positive guard: "cocoa butter" alone does NOT match Chocolate', () => {
      const hits = findToxicIngredients('dog', ['Lip balm with cocoa butter']);
      expect(hits.some((h) => h.toxin === 'Chocolate')).toBe(false);
    });

    test('false-positive guard: "carob" does NOT match', () => {
      const hits = findToxicIngredients('dog', ['Dog-safe carob chip cookie']);
      expect(hits.some((h) => h.toxin === 'Chocolate')).toBe(false);
    });
  });

  describe('Grapes / raisins', () => {
    test('"grapes" matches', () => {
      const hits = findToxicIngredients('dog', ['Trail mix with grapes']);
      expect(hits.some((h) => h.toxin === 'Grapes / Raisins')).toBe(true);
    });

    test('"raisins" matches', () => {
      const hits = findToxicIngredients('dog', ['Oatmeal raisin cookie']);
      expect(hits.some((h) => h.toxin === 'Grapes / Raisins')).toBe(true);
    });

    test('"sultanas" matches', () => {
      const hits = findToxicIngredients('dog', ['Sultanas']);
      expect(hits.some((h) => h.toxin === 'Grapes / Raisins')).toBe(true);
    });

    test('false-positive guard: "grapefruit" does NOT match grapes', () => {
      const hits = findToxicIngredients('dog', ['Grapefruit slice']);
      expect(hits.some((h) => h.toxin === 'Grapes / Raisins')).toBe(false);
    });
  });

  describe('Allium family', () => {
    test('"onion" matches', () => {
      const hits = findToxicIngredients('dog', ['Onion powder']);
      expect(hits.some((h) => h.toxin === 'Onion / Garlic / Allium')).toBe(true);
    });

    test('"garlic" matches', () => {
      const hits = findToxicIngredients('cat', ['Garlic-infused broth']);
      expect(hits.some((h) => h.toxin === 'Onion / Garlic / Allium')).toBe(true);
    });
  });

  describe('Cat-specific toxins', () => {
    test('"lily" matches for cats', () => {
      const hits = findToxicIngredients('cat', ['Easter lily']);
      expect(hits.some((h) => h.toxin === 'Lily')).toBe(true);
    });

    test('"lily" does NOT match for dogs (less acute)', () => {
      const hits = findToxicIngredients('dog', ['Easter lily']);
      expect(hits.some((h) => h.toxin === 'Lily')).toBe(false);
    });

    test('"raw tuna" matches for cats', () => {
      const hits = findToxicIngredients('cat', ['Raw tuna fillet']);
      expect(hits.some((h) => h.toxin === 'Raw fish (thiaminase)')).toBe(true);
    });

    test('cooked tuna does NOT match (raw-only)', () => {
      const hits = findToxicIngredients('cat', ['Cooked tuna']);
      expect(hits.some((h) => h.toxin === 'Raw fish (thiaminase)')).toBe(false);
    });
  });

  describe('hasToxicIngredients convenience', () => {
    test('returns true on hit', () => {
      expect(hasToxicIngredients('dog', ['xylitol'])).toBe(true);
    });
    test('returns false on clean', () => {
      expect(hasToxicIngredients('dog', ['Chicken, rice, peas'])).toBe(false);
    });
    test('handles null/undefined sources gracefully', () => {
      expect(hasToxicIngredients('dog', [null, undefined, ''])).toBe(false);
    });
  });

  describe('Multiple toxins in one food', () => {
    test('flags every distinct toxin', () => {
      const hits = findToxicIngredients('dog', [
        'Trail mix: raisins, chocolate chips, macadamia nuts',
      ]);
      const names = hits.map((h) => h.toxin);
      expect(names).toContain('Grapes / Raisins');
      expect(names).toContain('Chocolate');
      expect(names).toContain('Macadamia nuts');
    });
  });
});
