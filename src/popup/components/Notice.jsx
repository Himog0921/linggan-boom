import React from 'react';

export default function Notice({ message, type, visible, onClose }) {
  if (!visible) return null;
  return (
    <section className={`popup-notice ${type}`} id="popupNotice" aria-live="polite" aria-atomic="true">
      {message}
    </section>
  );
}
