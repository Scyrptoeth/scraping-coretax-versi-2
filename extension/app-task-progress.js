export function durationLabel(seconds) {
  const rounded = Math.max(1, Math.ceil(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return [minutes && minutes + ' menit', remainder && remainder + ' detik'].filter(Boolean).join(' ');
}

export function captureProgress({panel, bar, label, estimate}) {
  let started;
  function update(done, total, unit, approximate = false) {
    const measurable = Number.isSafeInteger(total) && total > 0 && (approximate ? done < total : done <= total);
    if (measurable) {
      bar.max = total;
      bar.value = done;
    } else {
      bar.removeAttribute('value');
    }
    bar.setAttribute('aria-valuetext', unit ? done + (measurable ? ' dari ' + total : '') + ' ' + unit : label.textContent);
    const count = unit ? done + (measurable ? ' dari ' + total : '') + ' ' + unit + ' diproses' : '';
    const remaining = measurable && done > 0 && done < total ? (performance.now() - started) / 1000 * (total - done) / done : null;
    estimate.textContent = [count, approximate && measurable ? 'Total dari pratinjau' : '',
      remaining !== null ? 'Perkiraan sisa tahap ini ' + durationLabel(remaining) : unit && (!measurable || !done) ? 'Estimasi belum tersedia' : ''
    ].filter(Boolean).join(' · ');
  }
  return {
    start(title) {
      started = performance.now();
      label.textContent = title;
      panel.hidden = false;
      update(0, null, '');
    },
    update,
    hide() { panel.hidden = true; }
  };
}
