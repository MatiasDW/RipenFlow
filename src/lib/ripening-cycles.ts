import type { RipeningRecipeProfile } from '@/data/ripening-cycles.generated'
import { ripeningCycleCatalog } from '@/data/ripening-cycles.generated'

export type RipeningScenarioId = 'balanced' | 'margin' | 'service'

const recipeSelectionByScenario: Record<
  RipeningScenarioId,
  {
    programCode: string
    targetColorGrade: string
  }
> = {
  balanced: {
    programCode: 'SOFTRIPE',
    targetColorGrade: '3.5',
  },
  margin: {
    programCode: 'SOFTRIPE',
    targetColorGrade: '3',
  },
  service: {
    programCode: 'TURBO',
    targetColorGrade: '3.5',
  },
}

function inferProductFamily(product: string) {
  const normalizedProduct = product.toLowerCase()

  if (
    normalizedProduct.includes('banana') ||
    normalizedProduct.includes('platano') ||
    normalizedProduct.includes('cavendish')
  ) {
    return 'banana'
  }

  return 'banana'
}

export function pickRipeningRecipe(
  product: string,
  scenarioId: string | undefined,
) {
  const selection =
    recipeSelectionByScenario[
      (scenarioId as RipeningScenarioId | undefined) ?? 'balanced'
    ] ?? recipeSelectionByScenario.balanced
  const productFamily = inferProductFamily(product)

  return (
    ripeningCycleCatalog.recipeProfiles.find(
      (profile) =>
        profile.productFamily === productFamily &&
        profile.programCode === selection.programCode &&
        profile.targetColorGrade === selection.targetColorGrade &&
        profile.variantCode === 'standard',
    ) ?? null
  )
}

export function listRipeningRecipes(product: string) {
  const productFamily = inferProductFamily(product)

  return ripeningCycleCatalog.recipeProfiles.filter(
    (profile) =>
      profile.productFamily === productFamily &&
      profile.variantCode === 'standard',
  )
}

export function getRecipeScenarioPenalty(
  recipe: Pick<RipeningRecipeProfile, 'programCode' | 'targetColorGrade'>,
  scenarioId: string | undefined,
) {
  const normalizedScenario =
    (scenarioId as RipeningScenarioId | undefined) ?? 'balanced'

  if (normalizedScenario === 'service') {
    return recipe.programCode === 'TURBO' ? 0 : 120
  }

  if (normalizedScenario === 'margin') {
    if (recipe.programCode === 'SOFTRIPE' && recipe.targetColorGrade === '3') {
      return 0
    }

    if (recipe.programCode === 'SOFTRIPE') {
      return 40
    }

    return 180
  }

  if (recipe.programCode === 'SOFTRIPE' && recipe.targetColorGrade === '3.5') {
    return 0
  }

  if (recipe.programCode === 'SOFTRIPE') {
    return 30
  }

  return 150
}
