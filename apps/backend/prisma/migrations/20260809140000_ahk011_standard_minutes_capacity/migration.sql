-- AlterTable
ALTER TABLE "Machine" ADD COLUMN "dailyCapacityMinutes" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "WorkOrderOperation" ADD COLUMN "standardMinutes" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "RecipeStep" ADD COLUMN "standardMinutes" DECIMAL(10,2);
