-- A trip keeps its own start and end day (owner 2026-10-13), the journey's
-- convention one level down (ADR 0002): a nullable calendar DATE per side.
-- NULL = that side still derives from the stations (`spanOf`), so every
-- stored roadtrip is untouched and nothing is back-filled.
ALTER TABLE "trip_routes" ADD COLUMN     "start_day" DATE,
ADD COLUMN     "end_day" DATE;
