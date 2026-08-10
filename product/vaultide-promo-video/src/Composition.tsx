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

const FPS = 30;
const INTRO = 6 * FPS;
const PROBLEM = 5 * FPS;
const EXTERNAL = 8 * FPS;
const OBSIDIAN = 8 * FPS;
const GRAPH = 8 * FPS;
const SAFETY = 6 * FPS;
const CTA = 4 * FPS;
const DURATION = INTRO + PROBLEM + EXTERNAL + OBSIDIAN + GRAPH + SAFETY + CTA;

const colors = {
	navy: '#071029',
	ink: '#0F1B3D',
	violet: '#7C3AED',
	cyan: '#22D3EE',
	blue: '#2563EB',
	pale: '#F4F6FF',
	muted: '#607096',
};

const fontFamily =
	'"Microsoft YaHei", "Noto Sans SC", "PingFang SC", Arial, sans-serif';

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
				opacity: interpolate(frame, [0, 14, duration - 14, duration], [0, 1, 1, 0], {
					extrapolateLeft: 'clamp',
					extrapolateRight: 'clamp',
				}),
			}}
		>
			{children}
		</AbsoluteFill>
	);
};

const GlowBackground: React.FC = () => (
	<AbsoluteFill
		style={{
			background:
				'radial-gradient(circle at 82% 18%, rgba(124,58,237,.28), transparent 34%), radial-gradient(circle at 15% 80%, rgba(34,211,238,.18), transparent 30%), linear-gradient(135deg,#071029,#11103C 58%,#091932)',
		}}
	/>
);

const Kicker: React.FC<{children: React.ReactNode; light?: boolean}> = ({
	children,
	light = false,
}) => (
	<div
		style={{
			display: 'inline-flex',
			alignItems: 'center',
			borderRadius: 999,
			padding: '13px 24px',
			fontSize: 30,
			fontWeight: 700,
			letterSpacing: 1,
			color: light ? '#BDF5FF' : colors.violet,
			background: light ? 'rgba(34,211,238,.13)' : '#EEE8FF',
		}}
	>
		{children}
	</div>
);

const ProductWindow: React.FC<{
	src: string;
	width: number;
	height: number;
	delay?: number;
}> = ({src, width, height, delay = 0}) => {
	const frame = useCurrentFrame();

	return (
		<div
			style={{
				width,
				height,
				overflow: 'hidden',
				borderRadius: 30,
				background: 'white',
				border: '1px solid rgba(141,153,189,.25)',
				boxShadow: '0 30px 90px rgba(27,38,88,.22)',
				opacity: interpolate(frame, [delay, delay + 18], [0, 1], {
					extrapolateLeft: 'clamp',
					extrapolateRight: 'clamp',
				}),
				scale: interpolate(frame, [delay, delay + 22], [0.96, 1], {
					extrapolateLeft: 'clamp',
					extrapolateRight: 'clamp',
					easing: Easing.bezier(0.16, 1, 0.3, 1),
				}),
				translate: `0 ${interpolate(frame, [delay, delay + 22], [36, 0], {
					extrapolateLeft: 'clamp',
					extrapolateRight: 'clamp',
					easing: Easing.bezier(0.16, 1, 0.3, 1),
				})}px`,
			}}
		>
			<Img
				src={staticFile(src)}
				style={{width: '100%', height: '100%', objectFit: 'contain'}}
			/>
		</div>
	);
};

const Intro: React.FC = () => {
	const frame = useCurrentFrame();
	return (
		<Scene duration={INTRO} background={colors.navy}>
			<Img
				src={staticFile('hero.png')}
				style={{
					width: '100%',
					height: '100%',
					objectFit: 'cover',
					opacity: 0.52,
					scale: interpolate(frame, [0, INTRO], [1.04, 1.11], {
						extrapolateRight: 'clamp',
					}),
				}}
			/>
			<AbsoluteFill
				style={{
					background:
						'linear-gradient(90deg, rgba(5,9,30,.95) 0%, rgba(5,9,30,.70) 48%, rgba(5,9,30,.18) 100%)',
				}}
			/>
			<div
				style={{
					position: 'absolute',
					inset: '90px 110px',
					display: 'flex',
					flexDirection: 'column',
					justifyContent: 'space-between',
				}}
			>
				<Img
					src={staticFile('logo-light.png')}
					style={{width: 440, objectFit: 'contain'}}
				/>
				<div style={{maxWidth: 1120, display: 'flex', flexDirection: 'column', gap: 28}}>
					<Kicker light>2026.07 学习闭环版</Kicker>
					<div
						style={{
							fontSize: 112,
							lineHeight: 1.08,
							fontWeight: 800,
							color: 'white',
							letterSpacing: -3,
							opacity: interpolate(frame, [18, 42], [0, 1], {
								extrapolateLeft: 'clamp',
								extrapolateRight: 'clamp',
							}),
							translate: `0 ${interpolate(frame, [18, 42], [45, 0], {
								extrapolateLeft: 'clamp',
								extrapolateRight: 'clamp',
								easing: Easing.bezier(0.16, 1, 0.3, 1),
							})}px`,
						}}
					>
						让知识真正
						<br />
						成为你的能力
					</div>
					<div style={{fontSize: 42, color: '#D9E7FF', fontWeight: 500}}>
						知洄 Vaultide · 个人智能学习操作系统
					</div>
				</div>
				<div style={{fontSize: 30, color: '#BDF5FF', fontWeight: 700}}>
					让每次学习，流回你的知识库
				</div>
			</div>
		</Scene>
	);
};

const Problem: React.FC = () => {
	const frame = useCurrentFrame();
	const statements = [
		['资料找到了', 16],
		['课堂听完了', 48],
		['但知识留下了吗？', 80],
	] as const;

	return (
		<Scene duration={PROBLEM}>
			<div
				style={{
					height: '100%',
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'center',
					gap: 28,
					textAlign: 'center',
				}}
			>
				<Kicker>学习真正的难点</Kicker>
				{statements.map(([text, delay], index) => (
					<div
						key={text}
						style={{
							fontSize: index === 2 ? 96 : 72,
							lineHeight: 1.08,
							fontWeight: index === 2 ? 800 : 650,
							color: index === 2 ? colors.violet : colors.ink,
							opacity: interpolate(frame, [delay, delay + 16], [0, 1], {
								extrapolateLeft: 'clamp',
								extrapolateRight: 'clamp',
							}),
							translate: `0 ${interpolate(frame, [delay, delay + 18], [24, 0], {
								extrapolateLeft: 'clamp',
								extrapolateRight: 'clamp',
							})}px`,
						}}
					>
						{text}
					</div>
				))}
			</div>
		</Scene>
	);
};

const ExternalKnowledge: React.FC = () => {
	const frame = useCurrentFrame();
	return (
		<Scene duration={EXTERNAL}>
			<div
				style={{
					height: '100%',
					padding: '100px 110px',
					display: 'grid',
					gridTemplateColumns: '660px 1fr',
					gap: 86,
					alignItems: 'center',
				}}
			>
				<div style={{display: 'flex', flexDirection: 'column', gap: 30}}>
					<Kicker>01 · 学习外部新知识</Kicker>
					<div style={{fontSize: 88, lineHeight: 1.1, fontWeight: 800}}>
						从权威资料
						<br />
						进入互动课堂
					</div>
					<div style={{fontSize: 38, lineHeight: 1.6, color: colors.muted}}>
						检索论文、技术、项目和前沿文章
						<br />
						保留来源，围绕真实目标开始学习
					</div>
					<div
						style={{
							display: 'flex',
							gap: 18,
							opacity: interpolate(frame, [72, 95], [0, 1], {
								extrapolateLeft: 'clamp',
								extrapolateRight: 'clamp',
							}),
						}}
					>
						{['检索', '课堂', '练习', '沉淀'].map((item, index) => (
							<div
								key={item}
								style={{
									borderRadius: 18,
									padding: '16px 24px',
									fontSize: 30,
									fontWeight: 700,
									color: index === 3 ? 'white' : colors.blue,
									background: index === 3 ? colors.violet : '#E9F1FF',
								}}
							>
								{item}
							</div>
						))}
					</div>
				</div>
				<ProductWindow src="home.png" width={930} height={720} delay={22} />
			</div>
		</Scene>
	);
};

const ObsidianLearning: React.FC = () => (
	<Scene duration={OBSIDIAN} background="#F7F4FF">
		<div
			style={{
				height: '100%',
				padding: '90px 110px',
				display: 'flex',
				flexDirection: 'column',
				gap: 50,
			}}
		>
			<div
				style={{
					display: 'flex',
					alignItems: 'flex-end',
					justifyContent: 'space-between',
					gap: 50,
				}}
			>
				<div style={{display: 'flex', flexDirection: 'column', gap: 22}}>
					<Kicker>02 · 学习 Obsidian 里的内容</Kicker>
					<div style={{fontSize: 82, lineHeight: 1.08, fontWeight: 800}}>
						已有笔记，也能重新学一遍
					</div>
				</div>
				<div style={{fontSize: 34, lineHeight: 1.5, color: colors.muted, textAlign: 'right'}}>
					单篇笔记或项目文件夹
					<br />
					都能进入网页课堂
				</div>
			</div>
			<div style={{display: 'flex', gap: 42, alignItems: 'center'}}>
				<ProductWindow src="classroom.png" width={1050} height={650} delay={20} />
				<div style={{display: 'flex', flexDirection: 'column', gap: 24}}>
					{[
						['上传', '只发送你批准的内容'],
						['学习', '网页是主要课堂场景'],
						['回写', 'Obsidian 最终确认'],
					].map(([title, body], index) => (
						<div
							key={title}
							style={{
								width: 500,
								borderRadius: 24,
								padding: '28px 32px',
								background: 'white',
								boxShadow: '0 15px 40px rgba(54,35,120,.10)',
							}}
						>
							<div style={{fontSize: 34, fontWeight: 800, color: colors.violet}}>
								{index + 1}. {title}
							</div>
							<div style={{fontSize: 27, color: colors.muted, marginTop: 9}}>{body}</div>
						</div>
					))}
				</div>
			</div>
		</div>
	</Scene>
);

const GraphScene: React.FC = () => (
	<Scene duration={GRAPH} background="#F5FBFF">
		<div
			style={{
				height: '100%',
				padding: '84px 110px',
				display: 'grid',
				gridTemplateColumns: '570px 1fr',
				gap: 70,
				alignItems: 'center',
			}}
		>
			<div style={{display: 'flex', flexDirection: 'column', gap: 28}}>
				<Kicker>03 · 归纳与知识关系</Kicker>
				<div style={{fontSize: 78, lineHeight: 1.08, fontWeight: 800}}>
					把多次学习
					<br />
					放进同一张知识地图
				</div>
				<div style={{fontSize: 35, lineHeight: 1.6, color: colors.muted}}>
					按时间、板块、来源和掌握度归纳
					<br />
					发现跨课堂连接与待强化区域
				</div>
				<div style={{display: 'flex', gap: 14, flexWrap: 'wrap'}}>
					{[
						['X', '时间', colors.blue],
						['Y', '板块', '#0891B2'],
						['Z', '掌握度', colors.violet],
					].map(([axis, label, color]) => (
						<div
							key={axis}
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: 12,
								borderRadius: 18,
								padding: '14px 20px',
								background: 'white',
								fontSize: 28,
								fontWeight: 700,
								color,
							}}
						>
							<span style={{fontSize: 38}}>{axis}</span>
							<span>{label}</span>
						</div>
					))}
				</div>
			</div>
			<ProductWindow src="knowledge.png" width={1120} height={820} delay={18} />
		</div>
	</Scene>
);

const SafetyScene: React.FC = () => {
	const frame = useCurrentFrame();
	return (
		<Scene duration={SAFETY} background={colors.navy}>
			<GlowBackground />
			<div
				style={{
					height: '100%',
					padding: '100px 110px',
					display: 'flex',
					flexDirection: 'column',
					justifyContent: 'center',
					alignItems: 'center',
					gap: 54,
					color: 'white',
					textAlign: 'center',
				}}
			>
				<Kicker light>你的知识库，由你掌控</Kicker>
				<div style={{fontSize: 92, fontWeight: 800, lineHeight: 1.08}}>
					原笔记不被静默覆盖
				</div>
				<div style={{display: 'flex', gap: 28}}>
					{[
						['只读来源', '原有笔记保持原样'],
						['双重确认', '网页批准 + 本地确认'],
						['专用目录', '学习结果进入 Vaultide/'],
					].map(([title, body], index) => (
						<div
							key={title}
							style={{
								width: 480,
								minHeight: 180,
								padding: '34px 30px',
								borderRadius: 28,
								background: 'rgba(255,255,255,.08)',
								border: '1px solid rgba(189,245,255,.22)',
								opacity: interpolate(frame, [40 + index * 18, 58 + index * 18], [0, 1], {
									extrapolateLeft: 'clamp',
									extrapolateRight: 'clamp',
								}),
								translate: `0 ${interpolate(frame, [40 + index * 18, 60 + index * 18], [24, 0], {
									extrapolateLeft: 'clamp',
									extrapolateRight: 'clamp',
								})}px`,
							}}
						>
							<div style={{fontSize: 38, fontWeight: 800, color: '#BDF5FF'}}>{title}</div>
							<div style={{fontSize: 27, marginTop: 20, color: '#D9E7FF'}}>{body}</div>
						</div>
					))}
				</div>
			</div>
		</Scene>
	);
};

const CallToAction: React.FC = () => {
	const frame = useCurrentFrame();
	return (
		<Scene duration={CTA} background={colors.navy}>
			<GlowBackground />
			<div
				style={{
					height: '100%',
					padding: '90px 110px',
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'center',
					gap: 36,
					color: 'white',
					textAlign: 'center',
				}}
			>
				<Img src={staticFile('logo-light.png')} style={{width: 500}} />
				<div
					style={{
						fontSize: 98,
						fontWeight: 800,
						lineHeight: 1.1,
						scale: interpolate(frame, [10, 34], [0.96, 1], {
							extrapolateLeft: 'clamp',
							extrapolateRight: 'clamp',
							easing: Easing.bezier(0.16, 1, 0.3, 1),
						}),
					}}
				>
					从一个真实问题开始
					<br />
					完成你的第一轮学习闭环
				</div>
				<div style={{fontSize: 38, color: '#BDF5FF', fontWeight: 700}}>
					openmaic-eight-eosin.vercel.app
				</div>
				<div style={{fontSize: 26, color: '#A8B7D9'}}>
					基于 OpenMAIC 构建 · 与 Obsidian 协同 · 非官方产品
				</div>
			</div>
		</Scene>
	);
};

const VaultidePromo: React.FC = () => (
	<AbsoluteFill>
		<Audio src={staticFile('ambient.m4a')} volume={0.7} />
		<Sequence from={0} durationInFrames={INTRO}>
			<Intro />
		</Sequence>
		<Sequence from={INTRO} durationInFrames={PROBLEM}>
			<Problem />
		</Sequence>
		<Sequence from={INTRO + PROBLEM} durationInFrames={EXTERNAL}>
			<ExternalKnowledge />
		</Sequence>
		<Sequence from={INTRO + PROBLEM + EXTERNAL} durationInFrames={OBSIDIAN}>
			<ObsidianLearning />
		</Sequence>
		<Sequence from={INTRO + PROBLEM + EXTERNAL + OBSIDIAN} durationInFrames={GRAPH}>
			<GraphScene />
		</Sequence>
		<Sequence
			from={INTRO + PROBLEM + EXTERNAL + OBSIDIAN + GRAPH}
			durationInFrames={SAFETY}
		>
			<SafetyScene />
		</Sequence>
		<Sequence
			from={INTRO + PROBLEM + EXTERNAL + OBSIDIAN + GRAPH + SAFETY}
			durationInFrames={CTA}
		>
			<CallToAction />
		</Sequence>
	</AbsoluteFill>
);

export const VaultideComposition: React.FC = () => (
	<Composition
		id="VaultidePromo2026"
		component={VaultidePromo}
		durationInFrames={DURATION}
		fps={FPS}
		width={1920}
		height={1080}
		defaultProps={{}}
	/>
);
