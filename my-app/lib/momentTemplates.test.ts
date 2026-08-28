import {
  availableColorways,
  detectTemplateUnlocks,
  getTemplateDef,
  lockedGateLine,
  lockedProgressLine,
  MOMENT_TEMPLATES,
  nextTemplateChipLine,
  nextTemplateUnlock,
  templateAwardId,
  templateUnlockLine,
  unlockedTemplateIds,
} from './momentTemplates';

// Words banned by the Pawtchi Copy Spec v1 (brand book § 6.04) — same list
// momentCard.test.ts and referral.test.ts enforce.
const BANNED_WORDS = [
  'immediately',
  'urgent',
  'ensure',
  'incredible',
  'amazing',
  'superstar',
  'alert',
  "don't forget",
  'ai-powered',
];

/** Every user-facing string must satisfy the locked brand voice. */
function assertBrandVoice(text: string) {
  expect(text).not.toContain('!');
  expect(text.toLowerCase()).not.toContain('your pet');
  for (const word of BANNED_WORDS) {
    expect(text.toLowerCase()).not.toContain(word);
  }
}

describe('registry shape', () => {
  test('fieldbook is the single day-one template and leads the shelf', () => {
    expect(MOMENT_TEMPLATES[0].id).toBe('fieldbook');
    expect(MOMENT_TEMPLATES.filter((t) => t.unlockAtWalks === null)).toHaveLength(1);
  });

  test('gates strictly ascend along the shelf', () => {
    const gates = MOMENT_TEMPLATES.filter((t) => t.unlockAtWalks !== null).map(
      (t) => t.unlockAtWalks!,
    );
    expect(gates).toEqual([...gates].sort((a, b) => a - b));
    expect(new Set(gates).size).toBe(gates.length);
  });

  test('award ids live in the template_ namespace, disjoint from pawPrints rungs', () => {
    for (const t of MOMENT_TEMPLATES) {
      expect(templateAwardId(t.id)).toBe(`template_${t.id}`);
    }
  });

  test('getTemplateDef throws on an unknown id', () => {
    expect(() => getTemplateDef('vaporwave' as never)).toThrow();
  });
});

describe('unlockedTemplateIds', () => {
  test('a new user has exactly the fieldbook', () => {
    expect([...unlockedTemplateIds(0, [])]).toEqual(['fieldbook']);
  });

  test('gates open exactly on the count, not before', () => {
    expect(unlockedTemplateIds(6, []).has('gallery')).toBe(false);
    expect(unlockedTemplateIds(7, []).has('gallery')).toBe(true);
    expect(unlockedTemplateIds(99, []).has('signature')).toBe(false);
    expect(unlockedTemplateIds(100, []).has('signature')).toBe(true);
  });

  test('a persisted award keeps a template unlocked even if the count regresses', () => {
    const ids = unlockedTemplateIds(3, ['template_postcard']);
    expect(ids.has('postcard')).toBe(true);
    expect(ids.has('gallery')).toBe(false);
  });

  test('foreign milestone ids in the awarded set are ignored', () => {
    const ids = unlockedTemplateIds(0, ['distance_50', 'walks_25']);
    expect([...ids]).toEqual(['fieldbook']);
  });
});

describe('detectTemplateUnlocks', () => {
  test('reports only gates crossed and not yet persisted, in ladder order', () => {
    const crossed = detectTemplateUnlocks(30, ['template_gallery']);
    expect(crossed.map((t) => t.id)).toEqual(['postcard', 'editorial']);
  });

  test('never reports the default template', () => {
    expect(detectTemplateUnlocks(500, [])).not.toContainEqual(
      expect.objectContaining({ id: 'fieldbook' }),
    );
  });

  test('idempotent once everything is persisted', () => {
    const all = MOMENT_TEMPLATES.filter((t) => t.unlockAtWalks !== null).map((t) =>
      templateAwardId(t.id),
    );
    expect(detectTemplateUnlocks(500, all)).toEqual([]);
  });
});

describe('nextTemplateUnlock', () => {
  test('walks the ladder rung by rung', () => {
    expect(nextTemplateUnlock(0)).toEqual({ def: getTemplateDef('gallery'), remaining: 7 });
    expect(nextTemplateUnlock(7)).toEqual({ def: getTemplateDef('postcard'), remaining: 8 });
    expect(nextTemplateUnlock(99)).toEqual({ def: getTemplateDef('signature'), remaining: 1 });
  });

  test('null once the ladder is climbed', () => {
    expect(nextTemplateUnlock(100)).toBeNull();
  });
});

describe('copy', () => {
  const gated = MOMENT_TEMPLATES.filter((t) => t.unlockAtWalks !== null);

  test('every string keeps the brand voice, and none states a completed count', () => {
    for (const def of gated) {
      for (const text of [
        lockedGateLine(def),
        lockedProgressLine(def, 3),
        lockedProgressLine(def, (def.unlockAtWalks ?? 1) - 1),
        templateUnlockLine(def),
      ]) {
        assertBrandVoice(text);
      }
      // The unlock line celebrates the card, never the milestone number.
      expect(templateUnlockLine(def)).not.toMatch(/\d/);
    }
  });

  test('locked lines read as access, singular grammar handled', () => {
    const gallery = getTemplateDef('gallery');
    expect(lockedGateLine(gallery)).toBe('Unlocks at 7 walks');
    expect(lockedProgressLine(gallery, 3)).toBe('4 more walks unlock the Gallery card');
    expect(lockedProgressLine(gallery, 6)).toBe('One more walk unlocks the Gallery card');
  });

  test('chip line tracks the nearest gate and goes quiet at the top', () => {
    expect(nextTemplateChipLine(4)).toBe('3 walks to the Gallery card');
    expect(nextTemplateChipLine(14)).toBe('One walk to the Postcard card');
    expect(nextTemplateChipLine(100)).toBeNull();
    assertBrandVoice(nextTemplateChipLine(4)!);
  });
});

describe('colorways', () => {
  test('classic is always available, premium colorways only when entitled', () => {
    const gallery = getTemplateDef('gallery');
    expect(availableColorways(gallery, false).map((c) => c.id)).toEqual(['classic']);
    expect(availableColorways(gallery, true).map((c) => c.id)).toEqual(['classic', 'dusk']);
  });

  test('premium never adds colorways a template does not declare', () => {
    const fieldbook = getTemplateDef('fieldbook');
    expect(availableColorways(fieldbook, true).map((c) => c.id)).toEqual(['classic']);
  });
});
