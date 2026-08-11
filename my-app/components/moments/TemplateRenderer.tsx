/**
 * TemplateRenderer — template id → card component, so the picker, the unlock
 * celebration, and any future surface render a template without knowing the
 * component zoo. Fieldbook routes to the original MomentCard and keeps its
 * extra powers (grounds, photo, tappable loop captions); the earned templates
 * are pure walk renderers.
 */

import React from 'react';
import { MomentCard, MomentGround } from '../MomentCard';
import type { MomentTemplateId } from '../../lib/momentTemplates';
import { GalleryCard } from './GalleryCard';
import { PostcardCard } from './PostcardCard';
import { EditorialCard } from './EditorialCard';
import { CartographerCard } from './CartographerCard';
import { SignatureCard } from './SignatureCard';
import type { TemplateCardProps } from './types';

export interface TemplateRendererProps extends TemplateCardProps {
  templateId: MomentTemplateId;
  /** Fieldbook-only: which ground the classic card stands on. */
  ground?: MomentGround;
  photoUri?: string | null;
  loopCaptions?: Record<number, string>;
  onLoopPress?: (index: number) => void;
}

export function TemplateRenderer({
  templateId,
  ground,
  photoUri,
  loopCaptions,
  onLoopPress,
  ...card
}: TemplateRendererProps) {
  switch (templateId) {
    case 'fieldbook':
      return (
        <MomentCard
          {...card}
          ground={ground}
          photoUri={photoUri}
          loopCaptions={loopCaptions}
          onLoopPress={onLoopPress}
        />
      );
    case 'gallery':
      return <GalleryCard {...card} />;
    case 'postcard':
      return <PostcardCard {...card} />;
    case 'editorial':
      return <EditorialCard {...card} />;
    case 'cartographer':
      return <CartographerCard {...card} />;
    case 'signature':
      return <SignatureCard {...card} />;
  }
}
