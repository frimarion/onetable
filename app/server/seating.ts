type Seat = { tableNo: number; seatNo: number };

export function planSeating(seats: Seat[], occupied: Seat[], waiting: string[]) {
  const taken = new Set(occupied.map(seat => key(seat)));
  const counts = new Map<number, number>();
  const capacities = new Map<number, number>();
  for (const { tableNo } of occupied) counts.set(tableNo, (counts.get(tableNo) ?? 0) + 1);
  for (const { tableNo } of seats) capacities.set(tableNo, (capacities.get(tableNo) ?? 0) + 1);
  const free = seats.filter(seat => !taken.has(key(seat)));

  return waiting.slice(0, free.length).map(playerId => {
    free.sort((a, b) =>
      (counts.get(a.tableNo) ?? 0) / capacities.get(a.tableNo)! -
      (counts.get(b.tableNo) ?? 0) / capacities.get(b.tableNo)! ||
      a.tableNo - b.tableNo || a.seatNo - b.seatNo);
    const seat = free.shift()!;
    counts.set(seat.tableNo, (counts.get(seat.tableNo) ?? 0) + 1);
    return { playerId, ...seat };
  });
}

function key({ tableNo, seatNo }: Seat) {
  return tableNo + '/' + seatNo;
}

