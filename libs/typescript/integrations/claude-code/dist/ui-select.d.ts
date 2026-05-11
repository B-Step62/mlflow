export interface SelectOption<T> {
    value: T;
    label: string;
    hint?: string;
}
export interface SelectPromptOptions<T> {
    question: string;
    options: SelectOption<T>[];
    defaultIndex?: number;
    input?: NodeJS.ReadStream;
    output?: NodeJS.WriteStream;
}
export declare function selectPrompt<T>(opts: SelectPromptOptions<T>): Promise<T>;
//# sourceMappingURL=ui-select.d.ts.map