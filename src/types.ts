export type TemplateTrans = {
	subject?: string;
	from_name?: string;
	[key: string]: string | undefined;
};

export type LocaleData = {
	from_name?: string;
	[templateName: string]: TemplateTrans | string | undefined;
};
