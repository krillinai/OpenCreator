import { useEffect, useState } from 'react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';

const slides = [
  '/dashboard/templates/image-generation/gpt-image.webp',
  '/dashboard/templates/image-generation/seedream-local.webp',
  '/dashboard/templates/image-generation/nano-local.webp',
  '/dashboard/templates/image-generation/local-unnamed.webp',
  '/dashboard/templates/image-generation/gpt-image-25.webp',
  '/dashboard/templates/image-generation/local-unnamed-1.webp',
  '/dashboard/templates/image-generation/gpt-image-2501.webp',
  '/dashboard/templates/image-generation/local-unnamed-2.webp'
];

export default function DashboardImageCarousel() {
  const l = useLocalizedCopy();
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (
      typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) return;
    const timer = window.setInterval(() => {
      setActive(current => (current + 1) % slides.length);
    }, 1800);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <span className="dashboard-app-media dashboard-app-carousel" role="img" aria-label={l('图像生成示例轮播', 'Image generation examples')}>
      {slides.map((src, index) => (
        <img key={src} className={index === active ? 'is-active' : ''} src={src} alt="" />
      ))}
      <span className="dashboard-app-carousel-dots" aria-hidden="true">
        {slides.map((src, index) => <span key={src} className={index === active ? 'is-active' : ''} />)}
      </span>
    </span>
  );
}
