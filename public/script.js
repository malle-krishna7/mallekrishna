const form = document.getElementById('contact-form');
const statusEl = document.getElementById('form-status');

if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (statusEl) statusEl.textContent = 'Sending...';

    const payload = {
      name: document.getElementById('name').value.trim(),
      email: document.getElementById('email').value.trim(),
      company: (document.getElementById('company')?.value || '').trim(),
      subject: document.getElementById('subject').value.trim(),
      message: document.getElementById('message').value.trim()
    };

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to send');
      }

      form.reset();
      if (statusEl) statusEl.textContent = 'Message sent successfully.';
    } catch (err) {
      if (statusEl) statusEl.textContent = `Error: ${err.message}`;
    }
  });
}

const navToggle = document.getElementById('nav-toggle');
const navLinks = document.getElementById('nav-links');
const themeToggle = document.getElementById('theme-toggle');
const themeLabel = themeToggle ? themeToggle.querySelector('.theme-label') : null;

if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('active');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });

  navLinks.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('active');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  if (themeToggle) {
    const isLight = theme === 'light';
    themeToggle.setAttribute('aria-pressed', String(isLight));
    if (themeLabel) themeLabel.textContent = isLight ? 'Dark' : 'Light';
  }
}

if (themeToggle) {
  const saved = localStorage.getItem('theme');
  const initial = saved || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  applyTheme(initial);

  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    applyTheme(next);
  });
}

const bookingForm = document.getElementById('booking-form');
const bookingStatus = document.getElementById('booking-status');
const calendarGrid = document.getElementById('calendar-grid');
const timeSlotsEl = document.getElementById('time-slots');
const selectedDateEl = document.getElementById('selected-date');
const durationSelect = document.getElementById('bk-duration');
const proposalForm = document.getElementById('proposal-form');
const proposalStatus = document.getElementById('proposal-status');

if (bookingForm) {
  const SLOT_STEP_MIN = 15;
  let config = {
    daysAhead: 14,
    startHour: 10,
    endHour: 18,
    bufferMinutes: 15,
    allowWeekends: false,
    blackoutDates: []
  };
  let availability = [];
  let selectedDateStr = '';

  const formatDay = (date) =>
    date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const formatTime = (date) =>
    date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  const toDateStr = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const buildDays = () => {
    const days = [];
    const today = new Date();
    for (let i = 0; i < config.daysAhead; i += 1) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      const dayKey = toDateStr(d);
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      const isBlackout = config.blackoutDates.includes(dayKey);
      if (!config.allowWeekends && isWeekend) {
        days.push({ date: d, disabled: true });
        continue;
      }
      if (isBlackout) {
        days.push({ date: d, disabled: true });
        continue;
      }
      days.push(d);
    }
    return days;
  };

  const isSlotTaken = (start, end) =>
    availability.some((b) => {
      const bufferMs = config.bufferMinutes * 60 * 1000;
      const bStart = new Date(new Date(b.startAt).getTime() - bufferMs);
      const bEnd = new Date(new Date(b.endAt).getTime() + bufferMs);
      return bStart < end && bEnd > start;
    });

  const renderCalendar = (days) => {
    calendarGrid.innerHTML = '';
    days.forEach((day) => {
      const dayObj = day.date ? day : { date: day, disabled: false };
      const dateValue = dayObj.date;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day-btn';
      const dayStr = toDateStr(dateValue);
      btn.dataset.date = dayStr;
      btn.innerHTML = `${dateValue.getDate()}<small>${dateValue.toLocaleDateString(undefined, { weekday: 'short' })}</small>`;
      if (dayObj.disabled) {
        btn.disabled = true;
      }
      if (dayStr === selectedDateStr) {
        btn.classList.add('active');
      }
      btn.addEventListener('click', () => {
        selectedDateStr = dayStr;
        document.querySelectorAll('.day-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderSlots();
      });
      calendarGrid.appendChild(btn);
    });
  };

  const renderSlots = () => {
    const duration = Number(durationSelect.value || 0);
    timeSlotsEl.innerHTML = '';
    document.getElementById('bk-start').value = '';

    if (!selectedDateStr) {
      selectedDateEl.textContent = '';
      return;
    }

    const selectedDate = new Date(`${selectedDateStr}T00:00:00`);
    selectedDateEl.textContent = formatDay(selectedDate);

    if (!duration) {
      timeSlotsEl.textContent = 'Select duration to see available times.';
      return;
    }

    const slots = [];
    for (let hour = config.startHour; hour <= config.endHour; hour += 1) {
      for (let minute = 0; minute < 60; minute += SLOT_STEP_MIN) {
        const slotStart = new Date(selectedDate);
        slotStart.setHours(hour, minute, 0, 0);
        const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000);
        if (slotEnd.getHours() > config.endHour || (slotEnd.getHours() === config.endHour && slotEnd.getMinutes() > 0)) {
          continue;
        }
        slots.push({ start: slotStart, end: slotEnd });
      }
    }

    if (slots.length === 0) {
      timeSlotsEl.textContent = 'No slots available.';
      return;
    }

    slots.forEach((slot) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'time-btn';
      btn.textContent = formatTime(slot.start);
      if (isSlotTaken(slot.start, slot.end)) {
        btn.disabled = true;
      }
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        document.querySelectorAll('.time-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('bk-start').value = slot.start.toISOString();
      });
      timeSlotsEl.appendChild(btn);
    });
  };

  const loadAvailability = async () => {
    try {
      const cfgRes = await fetch('/api/booking/config');
      const cfg = await cfgRes.json();
      config = { ...config, ...cfg };
    } catch {
      // use defaults
    }
    const days = buildDays();
    const first = days.find((d) => !(d.date ? d.disabled : false)) || days[0];
    const firstDate = first.date ? first.date : first;
    const last = days[days.length - 1];
    const lastDate = last.date ? last.date : last;
    const from = toDateStr(firstDate);
    const to = toDateStr(lastDate);
    try {
      const res = await fetch(`/api/booking/availability?from=${from}&to=${to}`);
      const data = await res.json();
      availability = Array.isArray(data.bookings) ? data.bookings : [];
    } catch {
      availability = [];
    }
    selectedDateStr = from;
    renderCalendar(days);
    renderSlots();
  };

  durationSelect.addEventListener('change', renderSlots);
  loadAvailability();

  bookingForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    bookingStatus.textContent = 'Booking...';

    const startInput = document.getElementById('bk-start').value;
    const startDate = new Date(startInput);

    if (Number.isNaN(startDate.getTime())) {
      bookingStatus.textContent = 'Please choose a slot.';
      return;
    }

    const payload = {
      name: document.getElementById('bk-name').value.trim(),
      email: document.getElementById('bk-email').value.trim(),
      phone: document.getElementById('bk-phone').value.trim(),
      service: document.getElementById('bk-service').value,
      durationMinutes: Number(document.getElementById('bk-duration').value),
      startAt: startDate.toISOString(),
      notes: document.getElementById('bk-notes').value.trim()
    };

    try {
      const res = await fetch('/api/booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to book slot');
      }

      bookingForm.reset();
      bookingStatus.textContent = 'Booking confirmed. I will email you soon.';
      await loadAvailability();
    } catch (err) {
      bookingStatus.textContent = `Error: ${err.message}`;
    }
  });
}

if (proposalForm) {
  proposalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    proposalStatus.textContent = 'Submitting...';

    const payload = {
      name: document.getElementById('pr-name').value.trim(),
      email: document.getElementById('pr-email').value.trim(),
      company: document.getElementById('pr-company').value.trim(),
      projectType: document.getElementById('pr-type').value,
      timeline: document.getElementById('pr-timeline').value,
      budgetRange: document.getElementById('pr-budget').value,
      details: document.getElementById('pr-details').value.trim()
    };

    try {
      const res = await fetch('/api/proposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to submit');
      }

      proposalForm.reset();
      proposalStatus.textContent = 'Request submitted. I will reply soon.';
    } catch (err) {
      proposalStatus.textContent = `Error: ${err.message}`;
    }
  });
}
