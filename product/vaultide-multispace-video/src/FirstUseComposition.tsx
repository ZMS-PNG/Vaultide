import type {Caption} from '@remotion/captions';
import {Audio} from '@remotion/media';
import {
	AbsoluteFill,
	Composition,
	Easing,
	Img,
	interpolate,
	Sequence,
	staticFile,
	useCurrentFrame,
} from 'remotion';
import captionData from './captions.json';

const FPS = 30;
const TRANSITION = 8;
const DURATIONS = [93, 213, 277, 214, 186, 190, 318, 120] as const;
const STARTS = DURATIONS.reduce<number[]>((starts, duration, index) => {
	if (index === 0) {
		return [0];
	}
	const previousStart = starts[index - 1];
	const previousDuration = DURATIONS[index - 1];
	return [...starts, previousStart + previousDuration - TRANSITION];
}, []);
const DURATION = STARTS[STARTS.length - 1] + DURATIONS[DURATIONS.length - 1];
const captions = captionData satisfies Caption[];

const colors = {
	navy: '#061027',
	ink: '#101B3B',
	violet: '#7137F5',
	cyan: '#17C7D8',
	blue: '#2C68EA',
	gold: '#F5A000',
	green: '#0DBA7D',
	pale: '#F5F7FF',
	muted: '#607096',
};

const fontFamily =
	'"Microsoft YaHei", "Noto Sans SC", "PingFang SC", Arial, sans-serif';

const fade = (frame: number, duration: number) =>
	interpolate(
		frame,
		[0, TRANSITION, duration - TRANSITION, duration],
		[0, 1, 1, 0],
		{
			extrapolateLeft: 'clamp',
			extrapolateRight: 'clamp',
		},
	);

const Scene: React.FC<{
	duration: number;
	children: React.ReactNode;
	background?: string;
}> = ({duration, children, background = colors.pale}) => {
	const frame = useCurrentFrame();

	return (
		<AbsoluteFill
			style={{
				background,
				color: colors.ink,
				fontFamily,
				opacity: fade(frame, duration),
				overflow: 'hidden',
			}}
		>
			{children}
		</AbsoluteFill>
	);
};

const GlowBackground: React.FC<{hero?: boolean}> = ({hero = false}) => {
	const frame = useCurrentFrame();
	return (
		<AbsoluteFill>
			{hero ? (
				<Img
					src={staticFile('hero-loop.png')}
					style={{
						width: '100%',
						height: '100%',
						objectFit: 'cover',
						opacity: 0.48,
						transform: `scale(${interpolate(frame, [0, 240], [1.02, 1.09], {
							extrapolateRight: 'clamp',
						})})`,
					}}
				/>
			) : null}
			<AbsoluteFill
				style={{
					background:
						'radial-gradient(circle at 82% 18%, rgba(113,55,245,.33), transparent 33%), radial-gradient(circle at 16% 82%, rgba(23,199,216,.18), transparent 31%), linear-gradient(135deg,rgba(6,16,39,.98),rgba(17,15,60,.94) 57%,rgba(5,23,45,.98))',
				}}
			/>
		</AbsoluteFill>
	);
};

const StarField: React.FC = () => {
	const frame = useCurrentFrame();
	const stars = Array.from({length: 42}, (_, index) => ({
		x: (index * 179 + 41) % 1920,
		y: (index * 283 + 97) % 1080,
		r: 1 + ((index * 17) % 3),
	}));

	return (
		<AbsoluteFill style={{pointerEvents: 'none'}}>
			{stars.map((star, index) => (
				<div
					key={`${star.x}-${star.y}`}
					style={{
						position: 'absolute',
						left: star.x,
						top: star.y,
						width: star.r * 2,
						height: star.r * 2,
						borderRadius: '50%',
						background: index % 4 === 0 ? colors.cyan : '#AAB8FF',
						boxShadow: index % 5 === 0 ? '0 0 15px currentColor' : undefined,
						opacity: 0.18 + 0.45 * Math.abs(Math.sin((frame + index * 9) / 18)),
						transform: `translateY(${Math.sin((frame + index * 7) / 24) * 8}px)`,
					}}
				/>
			))}
		</AbsoluteFill>
	);
};

const Brand: React.FC<{width?: number; light?: boolean}> = ({
	width = 390,
	light = true,
}) => (
	<Img
		src={staticFile(light ? 'logo-light-new.png' : 'logo-dark.png')}
		style={{width, objectFit: 'contain'}}
	/>
);

const Kicker: React.FC<{
	children: React.ReactNode;
	light?: boolean;
	color?: string;
}> = ({children, light = false, color = colors.violet}) => (
	<div
		style={{
			display: 'inline-flex',
			alignItems: 'center',
			alignSelf: 'flex-start',
			borderRadius: 999,
			padding: '12px 23px',
			fontSize: 28,
			fontWeight: 800,
			letterSpacing: 0.5,
			color: light ? '#C4F8FF' : color,
			background: light ? 'rgba(23,199,216,.12)' : `${color}16`,
			border: `1px solid ${light ? 'rgba(142,241,255,.25)' : `${color}24`}`,
		}}
	>
		{children}
	</div>
);

const Reveal: React.FC<{
	children: React.ReactNode;
	delay?: number;
	y?: number;
}> = ({children, delay = 0, y = 26}) => {
	const frame = useCurrentFrame();
	const progress = interpolate(frame, [delay, delay + 15], [0, 1], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
		easing: Easing.bezier(0.16, 1, 0.3, 1),
	});
	return (
		<div
			style={{
				opacity: progress,
				transform: `translateY(${(1 - progress) * y}px)`,
			}}
		>
			{children}
		</div>
	);
};

const ProductShot: React.FC<{
	src: string;
	width: number;
	height: number;
	delay?: number;
	fit?: 'contain' | 'cover';
	position?: string;
	accent?: string;
}> = ({
	src,
	width,
	height,
	delay = 8,
	fit = 'cover',
	position = 'center top',
	accent = 'rgba(94,104,151,.28)',
}) => {
	const frame = useCurrentFrame();
	const progress = interpolate(frame, [delay, delay + 18], [0, 1], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
		easing: Easing.bezier(0.16, 1, 0.3, 1),
	});
	const drift = interpolate(frame, [delay, delay + 210], [1.015, 1.035], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});

	return (
		<div
			style={{
				width,
				height,
				overflow: 'hidden',
				borderRadius: 30,
				background: 'white',
				border: `2px solid ${accent}`,
				boxShadow: `0 30px 90px rgba(27,38,88,.20), 0 0 48px ${accent}`,
				opacity: progress,
				transform: `translateY(${(1 - progress) * 34}px) scale(${0.97 + progress * 0.03})`,
			}}
		>
			<Img
				src={staticFile(src)}
				style={{
					width: '100%',
					height: '100%',
					objectFit: fit,
					objectPosition: position,
					transform: `scale(${drift})`,
				}}
			/>
		</div>
	);
};

const Voice: React.FC<{src: string}> = ({src}) => (
	<Audio src={staticFile(`voice-human/clean/${src}.wav`)} volume={1} />
);

const HookScene: React.FC = () => {
	const frame = useCurrentFrame();
	return (
		<Scene duration={DURATIONS[0]} background={colors.navy}>
			<GlowBackground hero />
			<StarField />
			<Voice src="01-hook" />
			<div
				style={{
					position: 'absolute',
					inset: '80px 110px 135px',
					display: 'flex',
					flexDirection: 'column',
					justifyContent: 'space-between',
					color: 'white',
				}}
			>
				<Brand width={405} />
				<div style={{maxWidth: 1280}}>
					<Reveal delay={4}>
						<Kicker light>第一次使用，不需要先装插件</Kicker>
					</Reveal>
					<div
						style={{
							marginTop: 30,
							fontSize: 104,
							lineHeight: 1.08,
							fontWeight: 900,
							letterSpacing: -2,
							opacity: interpolate(frame, [10, 24], [0, 1], {
								extrapolateLeft: 'clamp',
								extrapolateRight: 'clamp',
							}),
							transform: `translateY(${interpolate(frame, [10, 24], [36, 0], {
								extrapolateLeft: 'clamp',
								extrapolateRight: 'clamp',
								easing: Easing.bezier(0.16, 1, 0.3, 1),
							})}px)`,
						}}
					>
						先完成一堂网页课
						<br />
						再连接你的知识库
					</div>
				</div>
				<div
					style={{
						fontSize: 30,
						color: '#BFF8FF',
						fontWeight: 700,
						letterSpacing: 1,
					}}
				>
					从一个真实学习目标开始
				</div>
			</div>
		</Scene>
	);
};

const LoopScene: React.FC = () => {
	const items = [
		['目标', '先写学完后能做什么', colors.violet],
		['证据', '保留来源与适用范围', colors.blue],
		['课堂', '解释、提问与练习', colors.cyan],
		['验证', '回忆、费曼与迁移', colors.green],
		['沉淀', '安全写入伴随笔记', colors.gold],
		['归纳', '围绕问题生成结论', colors.violet],
		['复习', '按证据继续下一步', colors.blue],
	] as const;

	return (
		<Scene duration={DURATIONS[1]}>
			<Voice src="02-loop" />
			<div
				style={{
					height: '100%',
					padding: '74px 100px 132px',
					display: 'grid',
					gridTemplateColumns: '690px 1fr',
					gap: 66,
					alignItems: 'center',
				}}
			>
				<div style={{display: 'flex', flexDirection: 'column', gap: 27}}>
					<Reveal delay={3}>
						<Kicker>第一次只做一件事</Kicker>
					</Reveal>
					<Reveal delay={10}>
						<div style={{fontSize: 82, fontWeight: 900, lineHeight: 1.08}}>
							写清学完后能做什么
							<br />
							进入第一堂网页课
						</div>
					</Reveal>
					<div
						style={{
							display: 'grid',
							gridTemplateColumns: 'repeat(2, 1fr)',
							gap: 14,
						}}
					>
						{items.map(([title, subtitle, color], index) => (
							<Reveal key={title} delay={26 + index * 5} y={14}>
								<div
									style={{
										borderRadius: 20,
										background: 'white',
										border: `1px solid ${color}25`,
										boxShadow: '0 12px 32px rgba(28,41,92,.08)',
										padding: '17px 19px',
									}}
								>
									<div style={{fontSize: 28, fontWeight: 900, color}}>{title}</div>
									<div style={{fontSize: 19, color: colors.muted, marginTop: 4}}>
										{subtitle}
									</div>
								</div>
							</Reveal>
						))}
					</div>
				</div>
				<ProductShot
					src="home-loop.png"
					width={1060}
					height={820}
					delay={13}
					fit="cover"
					position="center top"
					accent="rgba(113,55,245,.28)"
				/>
			</div>
		</Scene>
	);
};

const ExternalScene: React.FC = () => {
	const sources = ['最新论文', '科研与前沿文章', '官方技术文档', 'GitHub 仓库'];
	const steps = [
		['1', '结果型目标'],
		['2', '权威来源优先'],
		['3', '保留证据'],
		['4', '进入互动课堂'],
	];
	return (
		<Scene duration={DURATIONS[2]}>
			<Voice src="03-external" />
			<div
				style={{
					height: '100%',
					padding: '64px 90px 132px',
					display: 'flex',
					flexDirection: 'column',
					gap: 30,
				}}
			>
				<div
					style={{
						display: 'flex',
						justifyContent: 'space-between',
						alignItems: 'flex-end',
					}}
				>
					<div style={{display: 'flex', flexDirection: 'column', gap: 18}}>
						<Kicker color={colors.blue}>第 1 步 · 先体验完整价值</Kicker>
						<div style={{fontSize: 74, lineHeight: 1.05, fontWeight: 900}}>
							选择“学习外部新知识”
							<br />
							让真实问题进入课堂
						</div>
					</div>
					<div
						style={{
							display: 'grid',
							gridTemplateColumns: 'repeat(2, auto)',
							gap: 12,
							paddingBottom: 5,
						}}
					>
						{sources.map((source, index) => (
							<Reveal key={source} delay={18 + index * 6} y={12}>
								<div
									style={{
										borderRadius: 999,
										padding: '12px 20px',
										background: '#E8F1FF',
										color: colors.blue,
										fontSize: 24,
										fontWeight: 800,
									}}
								>
									{source}
								</div>
							</Reveal>
						))}
					</div>
				</div>
				<div
					style={{
						display: 'grid',
						gridTemplateColumns: '1180px 1fr',
						gap: 34,
						alignItems: 'stretch',
						flex: 1,
					}}
				>
					<ProductShot
						src="external-learning.png"
						width={1180}
						height={700}
						delay={12}
						fit="cover"
						position="center top"
						accent="rgba(44,104,234,.30)"
					/>
					<div style={{display: 'flex', flexDirection: 'column', gap: 15}}>
						{steps.map(([number, label], index) => (
							<Reveal key={label} delay={28 + index * 13} y={15}>
								<div
									style={{
										height: 150,
										borderRadius: 24,
										background: 'white',
										boxShadow: '0 14px 36px rgba(28,41,92,.09)',
										padding: '24px 24px',
										display: 'flex',
										alignItems: 'center',
										gap: 18,
									}}
								>
									<div
										style={{
											width: 55,
											height: 55,
											flex: '0 0 55px',
											borderRadius: '50%',
											background: colors.blue,
											color: 'white',
											display: 'flex',
											alignItems: 'center',
											justifyContent: 'center',
											fontSize: 27,
											fontWeight: 900,
										}}
									>
										{number}
									</div>
									<div style={{fontSize: 29, fontWeight: 900}}>{label}</div>
								</div>
							</Reveal>
						))}
					</div>
				</div>
			</div>
		</Scene>
	);
};

const InternalScene: React.FC = () => (
		<Scene duration={DURATIONS[3]} background="#F7F4FF">
		<Voice src="04-internal" />
		<div
			style={{
				height: '100%',
				padding: '64px 90px 132px',
				display: 'flex',
				flexDirection: 'column',
				gap: 28,
			}}
		>
			<div
				style={{
					display: 'flex',
					justifyContent: 'space-between',
					alignItems: 'flex-end',
				}}
			>
				<div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
					<Kicker>第 2 步 · 确认有用后再连接</Kicker>
					<div style={{fontSize: 72, lineHeight: 1.06, fontWeight: 900}}>
						生成六位码，再选择笔记或项目
					</div>
				</div>
				<div style={{fontSize: 28, color: colors.muted, textAlign: 'right', lineHeight: 1.55}}>
					站点访问码 ≠ 六位配对码
					<br />
					六位码 10 分钟有效
				</div>
			</div>
			<div
				style={{
					display: 'grid',
					gridTemplateColumns: '1190px 1fr',
					gap: 34,
					alignItems: 'stretch',
					flex: 1,
				}}
			>
				<ProductShot
					src="obsidian-learning.png"
					width={1190}
					height={710}
					delay={9}
					fit="cover"
					position="center top"
					accent="rgba(113,55,245,.30)"
				/>
				<div style={{display: 'flex', flexDirection: 'column', gap: 18}}>
					{[
						['单篇笔记', 'Preview active note as a SourceBundle'],
						['项目文件夹', 'Preview a project folder as a SourceBundle'],
					].map(([title, command], index) => (
						<Reveal key={title} delay={26 + index * 16} y={16}>
							<div
								style={{
									borderRadius: 25,
									background: colors.navy,
									color: 'white',
									padding: '26px 28px',
									minHeight: 182,
									boxShadow: '0 18px 44px rgba(34,17,88,.18)',
								}}
							>
								<div style={{fontSize: 31, fontWeight: 900, color: '#C7F8FF'}}>
									{title}
								</div>
								<div
									style={{
										fontSize: 20,
										lineHeight: 1.45,
										marginTop: 17,
										color: '#D9E4FF',
										fontFamily: 'Consolas, monospace',
									}}
								>
									{command}
								</div>
							</div>
						</Reveal>
					))}
					<Reveal delay={58} y={15}>
						<div
							style={{
								borderRadius: 25,
								background: 'white',
								border: '2px solid rgba(13,186,125,.32)',
								padding: '25px 27px',
								boxShadow: '0 14px 34px rgba(28,41,92,.08)',
							}}
						>
							<div style={{fontSize: 31, fontWeight: 900, color: colors.green}}>
								原笔记始终只读
							</div>
							<div style={{fontSize: 23, marginTop: 10, color: colors.muted}}>
								学习进度与结果另行沉淀
							</div>
						</div>
					</Reveal>
				</div>
			</div>
		</div>
	</Scene>
);

const ActiveScene: React.FC = () => {
	const methods = [
		['闭卷回忆', '不看答案，先写下你记得什么', colors.violet],
		['费曼解释', '用自己的话说明概念与边界', colors.cyan],
		['迁移应用', '换一个场景，解决真实问题', colors.green],
	] as const;
	return (
		<Scene duration={DURATIONS[4]}>
			<Voice src="05-active" />
			<div
				style={{
					height: '100%',
					padding: '64px 90px 132px',
					display: 'grid',
					gridTemplateColumns: '690px 1fr',
					gap: 54,
					alignItems: 'center',
				}}
			>
				<div style={{display: 'flex', flexDirection: 'column', gap: 26}}>
					<Kicker color={colors.green}>第 3 步 · 留下掌握证据</Kicker>
					<div style={{fontSize: 80, lineHeight: 1.05, fontWeight: 900}}>
						看完只算进度
						<br />
						主动练习才算学会
					</div>
					<div style={{display: 'flex', flexDirection: 'column', gap: 17}}>
						{methods.map(([title, subtitle, color], index) => (
							<Reveal key={title} delay={21 + index * 12} y={15}>
								<div
									style={{
										borderRadius: 23,
										background: 'white',
										borderLeft: `8px solid ${color}`,
										boxShadow: '0 13px 32px rgba(28,41,92,.08)',
										padding: '22px 24px',
									}}
								>
									<div style={{fontSize: 31, fontWeight: 900}}>{title}</div>
									<div style={{fontSize: 21, marginTop: 5, color: colors.muted}}>
										{subtitle}
									</div>
								</div>
							</Reveal>
						))}
					</div>
				</div>
				<ProductShot
					src="active-learning.png"
					width={1080}
					height={760}
					delay={10}
					fit="cover"
					position="center top"
					accent="rgba(13,186,125,.28)"
				/>
			</div>
		</Scene>
	);
};

const DepositScene: React.FC = () => {
	const steps = [
		['原有笔记', '只读，不自动改写', colors.blue],
		['伴随笔记', '进度、证据、总结可持续更新', colors.violet],
		['双重确认', '网页预览 + Obsidian 最终批准', colors.green],
	] as const;
	return (
		<Scene duration={DURATIONS[5]} background="#F7F4FF">
			<Voice src="06-deposit" />
			<div
				style={{
					height: '100%',
					padding: '64px 90px 132px',
					display: 'flex',
					flexDirection: 'column',
					gap: 28,
				}}
			>
				<div
					style={{
						display: 'flex',
						justifyContent: 'space-between',
						alignItems: 'flex-end',
					}}
				>
					<div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
						<Kicker>第 4 步 · 安全沉淀到 Obsidian</Kicker>
						<div style={{fontSize: 72, lineHeight: 1.06, fontWeight: 900}}>
							网页先预览，本地最终确认
						</div>
					</div>
					<div
						style={{
							borderRadius: 999,
							background: colors.navy,
							color: '#C7F8FF',
							padding: '15px 24px',
							fontFamily: 'Consolas, monospace',
							fontSize: 22,
						}}
					>
						Check and apply Vaultide writebacks
					</div>
				</div>
				<div
					style={{
						display: 'grid',
						gridTemplateColumns: '1180px 1fr',
						gap: 34,
						alignItems: 'stretch',
						flex: 1,
					}}
				>
					<ProductShot
						src="safe-writeback.png"
						width={1180}
						height={710}
						delay={8}
						fit="cover"
						position="center top"
						accent="rgba(113,55,245,.28)"
					/>
					<div style={{display: 'flex', flexDirection: 'column', gap: 18}}>
						{steps.map(([title, subtitle, color], index) => (
							<Reveal key={title} delay={24 + index * 13} y={15}>
								<div
									style={{
										borderRadius: 24,
										background: 'white',
										boxShadow: '0 13px 34px rgba(28,41,92,.09)',
										padding: '25px 26px',
										minHeight: 175,
										borderTop: `7px solid ${color}`,
									}}
								>
									<div style={{fontSize: 32, fontWeight: 900, color}}>{title}</div>
									<div
										style={{
											fontSize: 22,
											lineHeight: 1.45,
											marginTop: 11,
											color: colors.muted,
										}}
									>
										{subtitle}
									</div>
								</div>
							</Reveal>
						))}
					</div>
				</div>
			</div>
		</Scene>
	);
};

const SynthesisScene: React.FC = () => {
	const frame = useCurrentFrame();
	const switchAt = 112;
	const graphOpacity = interpolate(frame, [switchAt - 8, switchAt + 13], [0, 1], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const synthesisOpacity = interpolate(frame, [switchAt - 8, switchAt + 10], [1, 0], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const lenses = [
		['逻辑链', '下一步应该沿哪条路径继续？', colors.violet],
		['主题岛', '哪些板块正在离散聚合？', colors.cyan],
		['来源流', '资料如何转化为课堂与笔记？', colors.gold],
		['时间演化', '知识在哪些阶段形成与增强？', colors.blue],
	] as const;

	return (
		<Scene duration={DURATIONS[6]} background={colors.navy}>
			<GlowBackground />
			<StarField />
			<Voice src="07-synthesis" />
			<div
				style={{
					position: 'absolute',
					inset: '54px 82px 128px',
					display: 'flex',
					flexDirection: 'column',
					gap: 22,
					color: 'white',
				}}
			>
				<div
					style={{
						display: 'flex',
						justifyContent: 'space-between',
						alignItems: 'flex-end',
					}}
				>
					<div>
						<Kicker light>第 5 步 · 累积两三堂课后再归纳</Kicker>
						<div style={{fontSize: 67, lineHeight: 1.06, fontWeight: 900, marginTop: 17}}>
						先问一个问题，再让关系图解释
						</div>
					</div>
					<div
						style={{
							maxWidth: 560,
							fontSize: 24,
							lineHeight: 1.5,
							color: '#C9D9F8',
							textAlign: 'right',
						}}
					>
						汇总课堂、来源与掌握证据
						<br />
						关系图只做结论的解释层
					</div>
				</div>
				<div
					style={{
						position: 'relative',
						display: 'grid',
						gridTemplateColumns: '1320px 1fr',
						gap: 28,
						flex: 1,
						alignItems: 'center',
					}}
				>
					<div style={{position: 'relative', width: 1320, height: 720}}>
						<div style={{position: 'absolute', inset: 0, opacity: synthesisOpacity}}>
							<ProductShot
								src="question-synthesis.png"
								width={1320}
								height={720}
								delay={7}
								fit="cover"
								position="center top"
								accent="rgba(23,199,216,.34)"
							/>
						</div>
						<div style={{position: 'absolute', inset: 0, opacity: graphOpacity}}>
							<ProductShot
								src="knowledge-space.png"
								width={1320}
								height={720}
								delay={switchAt - 11}
								fit="cover"
								position="center top"
								accent="rgba(113,55,245,.40)"
							/>
						</div>
					</div>
					<div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
						{lenses.map(([title, subtitle, color], index) => {
							const active =
								graphOpacity > 0.5 &&
								Math.min(3, Math.floor(interpolate(frame, [130, 215], [0, 4], {
									extrapolateLeft: 'clamp',
									extrapolateRight: 'clamp',
								}))) === index;
							return (
								<div
									key={title}
									style={{
										borderRadius: 20,
										padding: '19px 20px',
										background: active ? color : 'rgba(8,18,46,.84)',
										border: `1px solid ${active ? '#FFFFFF88' : `${color}70`}`,
										boxShadow: active ? `0 0 34px ${color}72` : undefined,
										opacity: interpolate(frame, [26 + index * 8, 41 + index * 8], [0, 1], {
											extrapolateLeft: 'clamp',
											extrapolateRight: 'clamp',
										}),
									}}
								>
									<div style={{fontSize: 29, fontWeight: 900}}>{title}</div>
									<div
										style={{
											fontSize: 18,
											lineHeight: 1.35,
											color: '#D8E6FF',
											marginTop: 5,
										}}
									>
										{subtitle}
									</div>
								</div>
							);
						})}
					</div>
				</div>
			</div>
		</Scene>
	);
};

const CtaScene: React.FC = () => {
	const frame = useCurrentFrame();
	return (
		<Scene duration={DURATIONS[7]} background={colors.navy}>
			<GlowBackground hero />
			<StarField />
			<Voice src="08-cta" />
			<div
				style={{
					position: 'absolute',
					inset: '72px 110px 130px',
					display: 'grid',
					gridTemplateColumns: '1fr 330px',
					gap: 86,
					alignItems: 'center',
					color: 'white',
				}}
			>
				<div style={{display: 'flex', flexDirection: 'column', gap: 26}}>
					<Brand width={480} />
					<div
						style={{
							fontSize: 94,
							fontWeight: 900,
							lineHeight: 1.08,
							transform: `scale(${interpolate(frame, [4, 22], [0.96, 1], {
								extrapolateLeft: 'clamp',
								extrapolateRight: 'clamp',
								easing: Easing.bezier(0.16, 1, 0.3, 1),
							})})`,
							transformOrigin: 'left center',
						}}
					>
						3 分钟开始
						<br />
						你的第一堂课
					</div>
					<div style={{fontSize: 34, fontWeight: 800, color: '#C5F8FF'}}>
						openmaic-eight-eosin.vercel.app
					</div>
					<div style={{fontSize: 25, color: '#AFC0E4'}}>
						先上网页首课 · 再连接 Obsidian · 最后归纳复习
					</div>
				</div>
				<div
					style={{
						padding: 16,
						background: 'white',
						borderRadius: 31,
						boxShadow: '0 0 66px rgba(23,199,216,.28)',
					}}
				>
					<Img src={staticFile('qr-new.png')} style={{width: 298, height: 298}} />
				</div>
			</div>
		</Scene>
	);
};

const CaptionOverlay: React.FC = () => {
	const frame = useCurrentFrame();
	const now = (frame / FPS) * 1000;
	const activeCaption = captions.find(
		(caption) => now >= caption.startMs && now <= caption.endMs,
	);
	if (!activeCaption) {
		return null;
	}
	return (
		<div
			style={{
				position: 'absolute',
				left: 120,
				right: 120,
				bottom: 34,
				height: 76,
				display: 'flex',
				justifyContent: 'center',
				alignItems: 'center',
				fontFamily,
				pointerEvents: 'none',
			}}
		>
			<div
				style={{
					maxWidth: 1660,
					padding: '12px 28px 14px',
					borderRadius: 18,
					background: 'rgba(4,10,28,.88)',
					border: '1px solid rgba(185,246,255,.22)',
					color: 'white',
					fontSize: 34,
					lineHeight: 1.25,
					fontWeight: 800,
					textAlign: 'center',
					textShadow: '0 2px 8px rgba(0,0,0,.35)',
					boxShadow: '0 9px 26px rgba(0,0,0,.20)',
				}}
			>
				{activeCaption.text}
			</div>
		</div>
	);
};

const ProgressLine: React.FC = () => {
	const frame = useCurrentFrame();
	const width = interpolate(frame, [0, DURATION - 1], [0, 100], {
		extrapolateRight: 'clamp',
	});
	return (
		<div
			style={{
				position: 'absolute',
				left: 0,
				right: 0,
				top: 0,
				height: 6,
				background: 'rgba(255,255,255,.12)',
			}}
		>
			<div
				style={{
					height: '100%',
					width: `${width}%`,
					background: 'linear-gradient(90deg,#17C7D8,#7137F5,#F5A000)',
					boxShadow: '0 0 16px rgba(23,199,216,.55)',
				}}
			/>
		</div>
	);
};

const VaultideFirstUse: React.FC = () => (
	<AbsoluteFill style={{background: colors.navy}}>
		<Audio
			src={staticFile('ambient-human.m4a')}
			volume={(frame) =>
				interpolate(
					frame,
					[0, 18, DURATION - 30, DURATION],
					[0, 0.12, 0.12, 0],
					{
						extrapolateLeft: 'clamp',
						extrapolateRight: 'clamp',
					},
				)
			}
		/>
		<Sequence from={STARTS[0]} durationInFrames={DURATIONS[0]}>
			<HookScene />
		</Sequence>
		<Sequence from={STARTS[1]} durationInFrames={DURATIONS[1]}>
			<LoopScene />
		</Sequence>
		<Sequence from={STARTS[2]} durationInFrames={DURATIONS[2]}>
			<ExternalScene />
		</Sequence>
		<Sequence from={STARTS[3]} durationInFrames={DURATIONS[3]}>
			<InternalScene />
		</Sequence>
		<Sequence from={STARTS[4]} durationInFrames={DURATIONS[4]}>
			<ActiveScene />
		</Sequence>
		<Sequence from={STARTS[5]} durationInFrames={DURATIONS[5]}>
			<DepositScene />
		</Sequence>
		<Sequence from={STARTS[6]} durationInFrames={DURATIONS[6]}>
			<SynthesisScene />
		</Sequence>
		<Sequence from={STARTS[7]} durationInFrames={DURATIONS[7]}>
			<CtaScene />
		</Sequence>
		<ProgressLine />
		<CaptionOverlay />
	</AbsoluteFill>
);

export const VaultideFirstUseComposition: React.FC = () => (
	<Composition
		id="VaultideFirstUseHumanVoice2026"
		component={VaultideFirstUse}
		durationInFrames={DURATION}
		fps={FPS}
		width={1920}
		height={1080}
		defaultProps={{}}
	/>
);
