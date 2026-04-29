import 'dotenv/config'

import { ripeningCycleCatalog } from '../src/data/ripening-cycles.generated'
import { db, sql } from './client'
import {
  ripeningPhaseDefinitions,
  ripeningRecipeProfiles,
  ripeningRecipeSteps,
} from './schema'

async function main() {
  await db.transaction(async (tx) => {
    await tx.delete(ripeningRecipeSteps)
    await tx.delete(ripeningRecipeProfiles)
    await tx.delete(ripeningPhaseDefinitions)

    if (ripeningCycleCatalog.phaseDefinitions.length > 0) {
      await tx.insert(ripeningPhaseDefinitions).values(
        ripeningCycleCatalog.phaseDefinitions.map((phase) => ({
          phaseNumber: phase.phaseNumber,
          phaseName: phase.phaseName,
          durationHours:
            phase.durationHours !== null ? String(phase.durationHours) : null,
          durationDays:
            phase.durationDays !== null ? String(phase.durationDays) : null,
          temperatureC: phase.temperatureC,
          reaction: phase.reaction,
          ambientHumidity: phase.ambientHumidity,
          ethylene: phase.ethylene,
          oxygen: phase.oxygen,
          carbonDioxide: phase.carbonDioxide,
          colorState: phase.colorState,
          doorsOpen: phase.doorsOpen,
        })),
      )
    }

    for (const recipe of ripeningCycleCatalog.recipeProfiles) {
      const insertedProfiles = await tx
        .insert(ripeningRecipeProfiles)
        .values({
          sourceWorkbook: ripeningCycleCatalog.sourceWorkbook,
          variantCode: recipe.variantCode,
          programCode: recipe.programCode,
          targetColorGrade: recipe.targetColorGrade,
          totalHours: String(recipe.totalHours),
          totalDays: String(recipe.totalDays),
          productFamily: recipe.productFamily,
        })
        .returning({
          id: ripeningRecipeProfiles.id,
        })

      const insertedProfile = insertedProfiles[0]

      if (!insertedProfile) {
        throw new Error(
          `Failed to insert recipe ${recipe.programCode} ${recipe.targetColorGrade}`,
        )
      }

      if (recipe.steps.length > 0) {
        await tx.insert(ripeningRecipeSteps).values(
          recipe.steps.map((step) => ({
            recipeProfileId: insertedProfile.id,
            phaseNumber: step.phaseNumber,
            sequenceNumber: step.sequenceNumber,
            targetTemperatureC:
              step.targetTemperatureC !== null
                ? String(step.targetTemperatureC)
                : null,
            durationHours:
              step.durationHours !== null ? String(step.durationHours) : null,
          })),
        )
      }
    }
  })

  const profileCount = await db.$count(ripeningRecipeProfiles)
  const stepCount = await db.$count(ripeningRecipeSteps)
  const phaseCount = await db.$count(ripeningPhaseDefinitions)

  console.log(
    `Seeded ${profileCount} ripening recipe profile(s), ${stepCount} step(s) and ${phaseCount} phase definition(s).`,
  )
}

main()
  .then(async () => {
    await sql.end()
  })
  .catch(async (error) => {
    console.error('Failed to seed ripening cycles', error)
    await sql.end({ timeout: 1 })
    process.exit(1)
  })
