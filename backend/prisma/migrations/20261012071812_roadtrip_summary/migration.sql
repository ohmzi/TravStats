-- AlterTable
ALTER TABLE "trip_routes" ADD COLUMN     "summary" TEXT,
ADD COLUMN     "summary_generated_at" TIMESTAMP(3),
ADD COLUMN     "summary_source" TEXT;
