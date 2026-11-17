document.querySelectorAll('.pv-combo').forEach((carousel) => {
  const track = carousel.querySelector('.pv-track');
  if (!track) return;
  const move = (direction) => {
    const item = track.firstElementChild;
    if (!item) return;
    track.scrollBy({ left: direction * (item.getBoundingClientRect().width + 24), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  carousel.querySelector('.pv-prev')?.addEventListener('click', () => move(-1));
  carousel.querySelector('.pv-next')?.addEventListener('click', () => move(1));
});
