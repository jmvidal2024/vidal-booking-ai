/**
 * booking.js — Demo booking engine (in-memory, barbershop demo data).
 *
 * Keeps services, availability slots and bookings in memory.
 * Designed to be swapped for a real Vidal Booking backend later.
 */

'use strict';

// ---------------------------------------------------------------------------
// Demo services
// ---------------------------------------------------------------------------

const SERVICES = [
  { id: 'svc_corte',  name: 'Haircut',          name_es: 'Corte de cabello', duration_min: 30, price: 25 },
  { id: 'svc_afeitado', name: 'Shave',          name_es: 'Afeitado',          duration_min: 25, price: 15 },
  { id: 'svc_combo',  name: 'Haircut + Beard',  name_es: 'Corte + Barba',     duration_min: 50, price: 35 },
];

/**
 * List all available services.
 * @returns {Array<{id:string,name:string,price:number,duration_min:number}>}
 */
function listServices() {
  return SERVICES.map((s) => ({ ...s }));
}

/**
 * Find a service by id.
 * @param {string} serviceId
 * @returns {object|null}
 */
function getService(serviceId) {
  return SERVICES.find((s) => s.id === serviceId) || null;
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

// Booked slots, keyed `${date}` -> Set of "HH:MM"
const takenSlots = new Map();
// Bookings store
const bookings = new Map();
let bookingSeq = 1;

/** Working hours: 9:00 AM to 6:00 PM, 30-minute slots. */
function allSlotsFor() {
  const slots = [];
  for (let h = 9; h < 18; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    slots.push(`${String(h).padStart(2, '0')}:30`);
  }
  return slots;
}

/**
 * Deterministic pseudo-random slot blocker so demos look realistic
 * (some slots taken) without real randomness per request.
 */
function pseudoTaken(serviceId, date, slot) {
  const seed = `${serviceId}|${date}|${slot}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % 10 < 3; // ~30% blocked
}

/**
 * Get free slots for a service on a date.
 * @param {string} serviceId
 * @param {string} date - YYYY-MM-DD
 * @returns {{service_id:string,date:string,slots:string[],error?:string}}
 */
function checkAvailability(serviceId, date) {
  const service = getService(serviceId);
  if (!service) {
    return { service_id: serviceId, date, slots: [], error: 'service_not_found' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    return { service_id: serviceId, date, slots: [], error: 'invalid_date' };
  }
  const taken = takenSlots.get(date) || new Set();
  const free = allSlotsFor().filter(
    (slot) => !taken.has(slot) && !pseudoTaken(serviceId, date, slot)
  );
  return { service_id: serviceId, date, slots: free };
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

/**
 * Create a booking.
 * @param {{service_id:string,date:string,time:string,customer_name:string,customer_phone:string}} input
 * @returns {{booking_id:string,status:string,service_id:string,date:string,time:string,amount:number}|{error:string}}
 */
function createBooking({ service_id, date, time, customer_name, customer_phone }) {
  const service = getService(service_id);
  if (!service) return { error: 'service_not_found' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return { error: 'invalid_date' };
  if (!/^\d{2}:\d{2}$/.test(time || '')) return { error: 'invalid_time' };
  if (!customer_name || customer_name.trim().length < 2) return { error: 'invalid_name' };

  const avail = checkAvailability(service_id, date);
  if (!avail.slots.includes(time)) {
    return { error: 'slot_not_available', available: avail.slots };
  }

  if (!takenSlots.has(date)) takenSlots.set(date, new Set());
  takenSlots.get(date).add(time);

  const bookingId = `bk_${String(bookingSeq++).padStart(4, '0')}`;
  const booking = {
    booking_id: bookingId,
    status: 'pending_payment',
    service_id,
    service_name: service.name,
    date,
    time,
    customer_name: customer_name.trim(),
    customer_phone: (customer_phone || '').trim(),
    amount: service.price,
    created_at: new Date().toISOString(),
  };
  bookings.set(bookingId, booking);
  return { ...booking };
}

/**
 * Get a booking by id.
 * @param {string} bookingId
 * @returns {object|null}
 */
function getBooking(bookingId) {
  return bookings.get(bookingId) || null;
}

module.exports = {
  listServices,
  getService,
  checkAvailability,
  createBooking,
  getBooking,
};
