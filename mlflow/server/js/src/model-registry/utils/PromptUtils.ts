const IS_PROMPT_TAG_KEY = "mlflow.prompt.is_prompt";

export function isPromptModel({ modelEntity }: any) {
  return true //modelEntity && modelEntity.tags.some((tag: any) => tag.key === IS_PROMPT_TAG_KEY);
}