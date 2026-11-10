// Seed podaci iz plana §13. ⚠️ vrijednosti označene TODO treba potvrditi s Darijom.

export type TourSlug = '5-tage-enduro-tour' | '8-tage-enduro-tour';

export interface Tour {
  id: 5 | 8;
  slug: TourSlug;
  name: string;
  days: number;
  nights: number;
  ridingDays: number;
  priceOwnBike: number;
  priceRentalBike: number;
}

export interface Departure {
  code: string;
  start: string; // ISO yyyy-mm-dd
  end: string;
  tours: (5 | 8)[];
  capacityPlaces: number;
  capacityRentalBikes: number;
  manualStatus: 'closed' | 'full' | null;
}

export interface Settings {
  singleRoomPerNight: number;
  gearPerDay: number;
  transferTiers: { min: number; max: number; price: number }[];
  transferAirports: string[];
  depositMode: 'per_booking' | 'per_person';
  depositAmount: number;
  holdMinutesCard: number;
  holdDaysBank: number;
}

export const tours: Tour[] = [
  { id: 5, slug: '5-tage-enduro-tour', name: '5-Tages-Tour', days: 5, nights: 4, ridingDays: 3, priceOwnBike: 650, priceRentalBike: 880 },
  // TODO(confirm-with-client): 850/1.200 € ili 650/980 €
  { id: 8, slug: '8-tage-enduro-tour', name: '8-Tages-Tour', days: 8, nights: 7, ridingDays: 5, priceOwnBike: 850, priceRentalBike: 1200 },
];

export const settings: Settings = {
  singleRoomPerNight: 20, // TODO(confirm-with-client): 13 / 15 / 20 €
  gearPerDay: 15, // TODO(confirm-with-client): je li oprema uključena u najam motora?
  transferTiers: [
    { min: 1, max: 3, price: 250 },
    { min: 4, max: 8, price: 400 },
    { min: 9, max: 17, price: 800 },
  ], // TODO(confirm-with-client): po smjeru ili povratno? Računamo po smjeru.
  transferAirports: ['Sarajevo (SJJ)', 'Split (SPU)', 'Banja Luka (BNX)'],
  depositMode: 'per_booking', // TODO(confirm-with-client): po rezervaciji ili po osobi
  depositAmount: 100,
  holdMinutesCard: 20,
  holdDaysBank: 5,
};

export const bikeModels = ['KTM 350 EXC-F', 'KTM 450 EXC-F', 'KTM 250 EXC TPI', 'KTM Freeride 250 F'];

const DEFAULT_PLACES = 17; // TODO(confirm-with-client)
const DEFAULT_RENTAL = 20; // TODO(confirm-with-client): 20 ili 24

const raw: [string, string, string, string, 'full' | null][] = [
  ['701', '2027-04-07', '2027-04-11', '5', null],
  ['702', '2027-04-14', '2027-04-18', '5', null],
  ['703', '2027-04-21', '2027-04-25', '5', null],
  ['704', '2027-04-24', '2027-05-01', '5/8', null],
  ['705', '2027-05-05', '2027-05-09', '5', 'full'],
  ['706', '2027-05-12', '2027-05-16', '5', null],
  ['707', '2027-05-15', '2027-05-22', '5/8', null],
  ['708', '2027-05-22', '2027-05-29', '5/8', null],
  ['709', '2027-05-29', '2027-06-05', '5/8', null],
  ['710', '2027-06-05', '2027-06-12', '5/8', null],
  ['711', '2027-06-12', '2027-06-19', '5/8', null],
  ['712', '2027-06-19', '2027-06-26', '5/8', null],
  ['713', '2027-06-26', '2027-07-03', '5/8', null],
  ['714', '2027-07-03', '2027-07-10', '5/8', null],
  ['715', '2027-07-10', '2027-07-17', '5/8', null],
  ['716', '2027-07-17', '2027-07-24', '5/8', null],
  ['717', '2027-07-24', '2027-07-31', '5/8', null],
  ['718', '2027-07-31', '2027-08-07', '5/8', 'full'],
  ['719', '2027-08-07', '2027-08-14', '5/8', 'full'],
  ['720', '2027-08-18', '2027-08-22', '5', null],
  ['721', '2027-08-21', '2027-08-28', '5/8', null],
  ['722', '2027-08-28', '2027-09-04', '5/8', null],
  ['723', '2027-09-04', '2027-09-11', '5/8', null],
  ['724', '2027-09-11', '2027-09-18', '5/8', null],
  ['725', '2027-09-18', '2027-09-25', '5/8', null],
  ['726', '2027-09-25', '2027-10-02', '5/8', null],
  ['727', '2027-10-02', '2027-10-09', '5/8', null],
  ['728', '2027-10-09', '2027-10-16', '5/8', null],
  ['729', '2027-10-16', '2027-10-23', '5/8', null],
  ['730', '2027-10-23', '2027-10-30', '5/8', null],
  ['731', '2027-10-30', '2027-11-06', '5/8', null],
];

export const departures: Departure[] = raw.map(([code, start, end, t, manualStatus]) => ({
  code,
  start,
  end,
  tours: t === '5' ? [5] : [5, 8],
  capacityPlaces: DEFAULT_PLACES,
  capacityRentalBikes: DEFAULT_RENTAL,
  manualStatus,
}));
