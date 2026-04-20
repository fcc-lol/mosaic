import React from 'react';
import styled from 'styled-components';
import { motion, AnimatePresence } from 'framer-motion';
import { ChunkButton } from '../styles/shared';

const Overlay = styled(motion.div)`
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  max-width: 640px;
  margin: 0 auto;
  padding: 0 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
  z-index: 10;

  ${ChunkButton} {
    flex: none;
    pointer-events: auto;
  }
`;

const staggerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, staggerDirection: -1 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

const spring = { type: 'spring', damping: 26, stiffness: 280 };

export default function CaptureOverlay({ visible, onSave, onPost, onClear }) {
  return (
    <AnimatePresence>
      {visible && (
        <Overlay
          initial="hidden"
          animate="visible"
          exit="hidden"
          variants={staggerVariants}
        >
          <ChunkButton $primary variants={itemVariants} transition={spring} onClick={onSave}>
            Save
          </ChunkButton>
          <ChunkButton $post variants={itemVariants} transition={spring} onClick={onPost}>
            Post to Cloud
          </ChunkButton>
          <ChunkButton $clear variants={itemVariants} transition={spring} onClick={onClear}>
            Clear
          </ChunkButton>
        </Overlay>
      )}
    </AnimatePresence>
  );
}
