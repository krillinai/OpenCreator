import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import DashboardPage from './DashboardPage.js';

describe('DashboardPage', () => {
  it('opens a Skill workspace directly and keeps its prompt as an inactive hint', () => {
    const onSelectPrompt = vi.fn();
    render(
      <DashboardPage
        onSelectPrompt={onSelectPrompt}
        skillLaunch={{
          skillId: 'video-translation-multilingual',
          workspace: 'video-translation',
          promptHint: '上传视频，或者输入有效的视频链接'
        }}
      />
    );

    expect(screen.getByRole('heading', { name: '视频翻译配音' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '告诉 Agent 你的要求' }))
      .toHaveAttribute('placeholder', '上传视频，或者输入有效的视频链接');
    expect(screen.getByRole('textbox', { name: '告诉 Agent 你的要求' })).toHaveValue('');
    expect(onSelectPrompt).not.toHaveBeenCalled();
  });

  it('renders the app directory in the selected English display language', () => {
    render(
      <LanguageProvider initialPreference="en-US">
        <DashboardPage onSelectPrompt={vi.fn()} />
      </LanguageProvider>
    );

    expect(screen.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Featured apps' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Video Editing' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search apps' })).toBeInTheDocument();
    expect(screen.getByText('Translate & Dub Video')).toBeInTheDocument();
    expect(screen.getAllByText('Digital Avatar')).toHaveLength(2);
    expect(screen.queryByText('Digital Presenter')).not.toBeInTheDocument();
  });

  it('keeps the video translation workflow and Agent in English', () => {
    render(
      <LanguageProvider initialPreference="en-US">
        <DashboardPage onSelectPrompt={vi.fn()} />
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open Translate & Dub Video' }));
    expect(screen.getByRole('heading', { name: 'Translate & Dub Video' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Drop a video here' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Video link' })).toHaveAttribute(
      'placeholder',
      'Paste a YouTube, Bilibili, or other video link'
    );
    expect(screen.getByText(/Add a video on the left/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Which platforms are supported?' })).toBeInTheDocument();
    expect(screen.queryByText('拖放视频到这里')).not.toBeInTheDocument();
  });

  it('uses the Home-style Agent composer across creator workspaces', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));
    const translationInput = screen.getByRole('textbox', { name: '告诉 Agent 你的要求' });
    expect(translationInput.closest('form')).toHaveClass('tool-agent-composer');
    expect(screen.getByRole('button', { name: '添加上下文' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择访问权限 请求批准' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择模型 默认模型' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '选择访问权限 请求批准' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /完全访问权限/ }));
    expect(screen.getByRole('button', { name: '选择访问权限 完全访问权限' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '选择模型 默认模型' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'GPT-5.6 Sol' }));
    expect(screen.getByRole('button', { name: '选择模型 GPT-5.6 Sol' })).toBeInTheDocument();

    const contextFile = new File(['notes'], 'translation-notes.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText('添加文件'), { target: { files: [contextFile] } });
    expect(screen.getByText('translation-notes.txt')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移除 translation-notes.txt' }));
    expect(screen.queryByText('translation-notes.txt')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '返回 Dashboard' }));
    fireEvent.click(screen.getByRole('button', { name: /^视频下载/ }));
    const downloadInput = screen.getByRole('textbox', { name: '告诉 Agent 视频下载 要求' });
    expect(downloadInput.closest('form')).toHaveClass('tool-agent-composer');
    expect(screen.getByRole('button', { name: '添加上下文' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择模型 默认模型' })).toBeInTheDocument();
  });

  it('renders featured apps and the searchable creator app directory', () => {
    const { container } = render(<DashboardPage onSelectPrompt={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '精选应用' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /打开.+/ })).toHaveLength(3);
    expect(screen.getByRole('button', { name: '打开火柴人动画生成' }).querySelector('img'))
      .toHaveAttribute('src', '/dashboard/templates/ai-video-insane.jpg');
    expect(screen.getByRole('button', { name: '打开视频翻译配音' }).querySelector('img'))
      .toHaveAttribute('src', '/dashboard/templates/video-translation-example.png');
    expect(screen.getByRole('region', { name: '创作应用' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '搜索应用' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^视频翻译/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^火柴人视频生成/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^数字人口播/ })).toBeInTheDocument();
    expect(container.querySelectorAll('.dashboard-app-card')).toHaveLength(12);
    expect(screen.queryByRole('button', { name: /^产品视觉/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^声音清理/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^字幕生成/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^音频增强/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^互动视频/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^视频下载 支持YouTube，Bilibili等/ }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^封面生成 生成视频与内容封面/ }))
      .toBeInTheDocument();
  });

  it('opens the video translation workspace and keeps its result in place', () => {
    const onSelectPrompt = vi.fn();
    render(<DashboardPage onSelectPrompt={onSelectPrompt} />);

    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));

    expect(screen.getByRole('heading', { name: '视频翻译配音' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'OpenCreator' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '拖放视频到这里' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=test' }
    });
    expect(screen.getByTitle('YouTube 视频预览')).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/test'
    );
    expect(screen.queryByRole('heading', { name: '拖放视频到这里' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '改用本地视频' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '视频链接' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(screen.getByRole('heading', { name: '设置翻译语言' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(screen.getByLabelText('任务摘要')).toHaveTextContent('简体中文 → English');
    fireEvent.click(screen.getByRole('button', { name: '开始翻译' }));

    expect(onSelectPrompt).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: '视频翻译项目' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '成片' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('已完成，V1')).toBeInTheDocument();
    expect(screen.getByText('V1 已生成完成')).toBeInTheDocument();
    expect(screen.queryByText(/之前的版本仍可查看/)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '生成新版本' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '生成新版本' })).not.toBeInTheDocument();
  });

  it('shows the translation steps and reopens completed steps', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));

    const steps = screen.getByRole('navigation', { name: '翻译流程' });
    expect(within(steps).getByRole('button', { name: '1 添加视频' })).toHaveAttribute('aria-current', 'step');
    expect(within(steps).getByRole('button', { name: '2 翻译设置' })).toBeDisabled();
    expect(within(steps).getByRole('button', { name: '3 配音与输出' })).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=steps-test' }
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(within(steps).getByRole('button', { name: /翻译设置$/ })).toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(within(steps).getByRole('button', { name: /配音与输出$/ })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByLabelText('任务摘要')).toBeInTheDocument();

    fireEvent.click(within(steps).getByRole('button', { name: /翻译设置$/ }));
    expect(screen.getByRole('heading', { name: '设置翻译语言' })).toBeInTheDocument();
    fireEvent.click(within(steps).getByRole('button', { name: /配音与输出$/ }));
    expect(screen.getByRole('heading', { name: '选择输出内容' })).toBeInTheDocument();
  });

  it('parses a public video link and exposes video and audio download variants', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^视频下载/ }));

    expect(screen.getByRole('heading', { name: '视频下载' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '待下载视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=download-test' }
    });
    fireEvent.click(screen.getByRole('button', { name: '解析链接' }));

    expect(screen.getByRole('tab', { name: '下载规格' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('任务摘要')).toHaveTextContent('来源平台YouTube');
    expect(screen.getByLabelText('任务摘要')).toHaveTextContent('当前规格1080p');
    expect(screen.queryByRole('button', { name: /已完成，V/ })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /1080p/ })).toBeChecked();
    fireEvent.click(screen.getByRole('tab', { name: /MP3 音频/ }));
    expect(screen.getByRole('radio', { name: /320kbps/ })).toBeChecked();
    fireEvent.click(screen.getByRole('tab', { name: '视频信息' }));
    expect(screen.getByRole('region', { name: '视频下载结果' })).toHaveTextContent('YouTube');

    fireEvent.click(screen.getByRole('button', { name: '下载 1080p 视频' }));
    expect(screen.getByRole('tab', { name: '下载记录' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('YouTube MP4 1080p 已加入下载队列');
    expect(screen.getByText('已创建 MP4 1080p 下载任务。')).toBeInTheDocument();
  });

  it('generates a stickman character before storyboard and video', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '打开火柴人动画生成' }));

    expect(screen.getByRole('heading', { name: '火柴人视频生成' })).toBeInTheDocument();
    const stickmanSteps = screen.getByRole('navigation', { name: '火柴人生成流程' });
    expect(within(stickmanSteps).getByRole('button', { name: '1 选择角色' })).toHaveAttribute('aria-current', 'step');
    expect(within(stickmanSteps).getByRole('button', { name: '2 故事与分镜' })).toBeDisabled();
    expect(within(stickmanSteps).getByRole('button', { name: '3 生成视频' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: '默认角色' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '生成角色' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '上传角色' })).toBeInTheDocument();
    const characterPresets = screen.getByRole('radiogroup', { name: '默认角色' });
    expect(within(characterPresets).getAllByRole('radio')).toHaveLength(10);
    const defaultCharacter = within(characterPresets).getByRole('radio', { name: /默认角色/ });
    expect(defaultCharacter).toBeChecked();
    expect(screen.queryByText('简洁造型，适合通用叙事')).not.toBeInTheDocument();
    const selectedCharacterPreview = screen.getByRole('complementary', { name: '已选角色全身预览' });
    expect(within(selectedCharacterPreview).getByRole('img', { name: '默认角色' })).toHaveAttribute(
      'src',
      '/dashboard/characters/default.png'
    );
    expect(within(characterPresets).getByRole('radio', { name: /^健身$/ })).toBeInTheDocument();
    expect(within(characterPresets).getByRole('radio', { name: /^嘻哈$/ })).toBeInTheDocument();
    fireEvent.click(within(characterPresets).getByRole('radio', { name: /科技男/ }));
    expect(within(characterPresets).getByRole('radio', { name: /科技男/ })).toBeChecked();
    expect(within(selectedCharacterPreview).getByRole('img', { name: '科技男' })).toHaveAttribute(
      'src',
      '/dashboard/characters/tech-guy.png'
    );
    fireEvent.click(screen.getByRole('tab', { name: '上传角色' }));
    expect(screen.getByRole('complementary', { name: '角色图片上传建议' })).toHaveTextContent(
      '人物全身完整可见，背景干净简洁，保持单人清晰且无遮挡。'
    );
    fireEvent.click(screen.getByRole('tab', { name: '生成角色' }));
    const generateCharacterButton = screen.getByRole('button', { name: '生成角色形象' });
    const characterActions = generateCharacterButton.closest('footer');
    expect(characterActions).toHaveClass('stickman-wizard-actions');
    expect(within(characterActions!).getByRole('button', { name: '下一步：故事与分镜' })).toBeEnabled();
    fireEvent.click(generateCharacterButton);
    expect(screen.getByRole('img', { name: '生成的火柴人角色形象' })).toHaveAttribute(
      'src',
      '/dashboard/characters/default.png'
    );
    fireEvent.click(screen.getByRole('tab', { name: '默认角色' }));
    fireEvent.click(screen.getByRole('radio', { name: /科技男/ }));
    expect(screen.queryByRole('heading', { name: '生成分镜' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一步：故事与分镜' }));
    expect(screen.queryByRole('heading', { name: '准备主角' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '生成分镜' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '故事创意' })).toHaveAttribute('rows', '5');
    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    expect(screen.getByRole('heading', { name: '准备主角' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一步：故事与分镜' }));
    fireEvent.click(screen.getByRole('button', { name: '生成分镜图' }));
    expect(screen.getByText('建立场景')).toBeInTheDocument();
    expect(screen.getAllByText(/s$/)).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /根据分镜生成视频/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一步：生成视频' }));
    expect(screen.getByLabelText('任务摘要')).toHaveTextContent('角色科技男');
    expect(screen.getByLabelText('任务摘要')).toHaveTextContent('分镜4 个镜头');
    fireEvent.click(screen.getByRole('button', { name: /根据分镜生成视频/ }));
    expect(screen.getByText('火柴人动画-V1.mp4')).toBeInTheDocument();
    expect(screen.getByLabelText('任务摘要')).toHaveTextContent('当前版本V1');
    expect(screen.getByRole('button', { name: '已完成，V1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '成片' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '分镜' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '角色' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '任务设置' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '分镜' }));
    expect(screen.getByRole('heading', { name: '故事分镜' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '调整分镜' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '角色' }));
    expect(screen.getByRole('img', { name: '科技男' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更换角色' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '任务设置' }));
    expect(screen.getByRole('heading', { name: '当前版本设置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '调整角色' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '调整故事与画面' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '让 Agent 重新生成视频' }));
    expect(screen.getByText('设置没有变化，继续查看 V1，未创建新版本。')).toBeInTheDocument();
    expect(screen.queryByText('火柴人动画-V2.mp4')).not.toBeInTheDocument();

    fireEvent.click(within(stickmanSteps).getByRole('button', { name: /故事与分镜$/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '故事创意' }), {
      target: { value: '一个商务角色在会议中用图表解释新产品。' }
    });
    fireEvent.click(screen.getByRole('button', { name: '生成分镜图' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步：生成视频' }));
    expect(screen.getByText('正在基于 V1 调整')).toBeInTheDocument();
    expect(screen.getByText('原版本的角色、分镜和成片仍可查看')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '生成 V2' }));

    expect(screen.getByText('火柴人动画-V2.mp4')).toBeInTheDocument();
    expect(screen.getByText('V2 已生成完成，之前的版本仍可查看')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '已完成，V2' }));
    const stickmanVersionMenu = screen.getByRole('menu');
    expect(within(stickmanVersionMenu).getByText('已完成，V1')).toBeInTheDocument();
    expect(within(stickmanVersionMenu).getByText('已完成，V2')).toBeInTheDocument();
    fireEvent.click(within(stickmanVersionMenu).getByText('已完成，V1').closest('button') as HTMLButtonElement);
    expect(screen.getByText('火柴人动画-V1.mp4')).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('navigation', { name: '火柴人生成流程' })).getByRole('button', { name: /故事与分镜$/ }));
    fireEvent.change(screen.getByRole('combobox', { name: '视频比例' }), {
      target: { value: '9:16' }
    });
    fireEvent.click(screen.getByRole('button', { name: '生成分镜图' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步：生成视频' }));
    fireEvent.click(screen.getByRole('button', { name: '生成 V3' }));
    expect(screen.getByText('火柴人动画-V3.mp4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '已完成，V3' }));
    expect(screen.getByRole('menu')).toHaveTextContent('基于 V1 调整，当前查看');
  });

  it('uses the same transparent stickman artwork in dark and light themes', () => {
    document.documentElement.dataset.theme = 'dark';
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '打开火柴人动画生成' }));

    const defaultCharacter = screen.getByRole('radio', { name: /默认角色/ });
    const artwork = defaultCharacter.querySelector<HTMLImageElement>('.stickman-character-artwork');
    expect(artwork).toHaveAttribute('src', '/dashboard/characters/default.png');

    document.documentElement.dataset.theme = 'light';
    expect(artwork).toHaveAttribute('src', '/dashboard/characters/default.png');
    document.documentElement.dataset.theme = 'dark';
  });

  it('extracts ten scored clips with subtitles from a long video', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^自动剪辑/ }));

    const clipSteps = screen.getByRole('navigation', { name: '自动剪辑流程' });
    expect(within(clipSteps).getByRole('button', { name: '1 添加视频' })).toHaveAttribute('aria-current', 'step');
    expect(within(clipSteps).getByRole('button', { name: '2 分析设置' })).toBeDisabled();
    expect(within(clipSteps).getByRole('button', { name: '3 选择与导出' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: '公开视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=long-video' }
    });
    fireEvent.click(screen.getByRole('button', { name: '下一步：分析设置' }));
    expect(screen.getByRole('heading', { name: '设置分析目标' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '识别语义并提取片段' }));

    expect(screen.getByText('已找到 10 个候选片段')).toBeInTheDocument();
    expect(screen.getByLabelText('任务摘要')).toHaveTextContent('内容偏好综合表现');
    expect(screen.getByLabelText('任务摘要')).toHaveTextContent('候选片段10');
    expect(screen.getByRole('button', { name: '已完成，V1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '候选片段' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '字幕与评分' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '导出内容' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '任务设置' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^查看片段/ })).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: /^查看片段 1 / }));
    const detail = screen.getByRole('complementary', { name: '片段 1 详情' });
    expect(detail).toHaveTextContent('开头吸引力94');
    expect(detail).toHaveTextContent('语义完整度92');
    expect(detail).toHaveTextContent('很多人一开始就急着使用工具');

    fireEvent.click(within(clipSteps).getByRole('button', { name: /分析设置$/ }));
    fireEvent.click(screen.getByRole('button', { name: '识别语义并提取片段' }));
    expect(screen.getByRole('status')).toHaveTextContent('设置没有变化，继续查看 V1，未创建新版本');
    expect(screen.queryByRole('button', { name: '已完成，V2' })).not.toBeInTheDocument();

    fireEvent.click(within(clipSteps).getByRole('button', { name: /分析设置$/ }));
    fireEvent.change(screen.getByRole('combobox', { name: '内容偏好' }), { target: { value: 'viral' } });
    fireEvent.click(screen.getByRole('button', { name: '重新分析并生成 V2' }));
    expect(screen.getByRole('button', { name: '已完成，V2' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '已完成，V2' }));
    expect(screen.getByRole('menu')).toHaveTextContent('已完成，V1');
  });

  it('generates four cover variants from prompt and supports ratio changes', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^封面生成/ }));

    expect(screen.getByRole('heading', { name: '封面生成' })).toBeInTheDocument();
    const coverSteps = screen.getByRole('navigation', { name: '封面生成流程' });
    expect(within(coverSteps).getByRole('button', { name: '1 设置封面' })).toHaveAttribute('aria-current', 'step');
    expect(within(coverSteps).getByRole('button', { name: '2 查看方案' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /1:1/ }));
    fireEvent.click(screen.getByRole('button', { name: '生成 4 个封面' }));

    expect(screen.getByRole('region', { name: '封面生成项目产出' })).toBeInTheDocument();
    expect(screen.getByLabelText('任务摘要')).toHaveTextContent('封面比例1:1');
    expect(screen.getByLabelText('任务摘要')).toHaveTextContent('生成数量4');
    expect(screen.getByRole('button', { name: '已完成，V1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '封面方案' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '参考素材' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '任务设置' })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /^封面方案/ })).toHaveLength(4);
    fireEvent.click(screen.getByRole('tab', { name: '任务设置' }));
    expect(screen.getByRole('region', { name: '封面生成项目产出' })).toHaveTextContent('封面比例1:1');

    fireEvent.click(within(coverSteps).getByRole('button', { name: /设置封面$/ }));
    fireEvent.click(screen.getByRole('button', { name: '生成 4 个封面' }));
    expect(screen.getByRole('status')).toHaveTextContent('设置没有变化，继续查看 V1，未创建新版本');

    fireEvent.click(within(coverSteps).getByRole('button', { name: /设置封面$/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '封面提示词' }), { target: { value: '蓝色科技感，人物主体更大，标题更醒目' } });
    fireEvent.click(screen.getByRole('button', { name: '生成 V2' }));
    expect(screen.getByRole('button', { name: '已完成，V2' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '已完成，V2' }));
    const versionMenu = screen.getByRole('menu');
    expect(versionMenu).toHaveTextContent('已完成，V1');
    expect(versionMenu).toHaveTextContent('已完成，V2');
  });

  it('edits and saves generated subtitles without leaving the result workspace', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=test' }
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '开始翻译' }));

    fireEvent.click(screen.getByRole('tab', { name: '字幕' }));
    const firstSubtitle = screen.getByRole('textbox', { name: '字幕 1' });
    fireEvent.change(firstSubtitle, { target: { value: 'A manually edited subtitle.' } });
    expect(screen.getByText('有未保存修改')).toBeInTheDocument();
    const subtitleEditor = screen.getByRole('region', { name: '生成新版本' })
      .previousElementSibling as HTMLElement;
    expect(subtitleEditor).toContainElement(firstSubtitle);
    fireEvent.click(screen.getByRole('button', { name: '保存字幕' }));

    expect(screen.getByText('所有修改已保存')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('字幕修改已保存');
    expect(screen.getByRole('region', { name: '生成新版本' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成 V2' })).toBeInTheDocument();
  });

  it('requires confirmation before the Agent changes output files or creates a version', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=test' }
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '开始翻译' }));

    fireEvent.click(screen.getByRole('button', { name: '修改字幕' }));
    const composer = screen.getByRole('textbox', { name: '告诉 Agent 你的要求' });
    fireEvent.change(composer, { target: { value: '把第2条字幕改为 Welcome back to OpenCreator.' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(screen.getByRole('textbox', { name: '字幕 2' })).toHaveValue('Welcome back to OpenCreator.');
    expect(screen.getByText('有未保存修改')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '生成新版本' }));
    const regenerateConfirmation = screen.getByRole('group', { name: '确认生成新版本' });
    expect(regenerateConfirmation).toHaveTextContent('确认生成 V2');
    expect(regenerateConfirmation).toHaveTextContent('更新字幕、成片');
    fireEvent.click(within(regenerateConfirmation).getByRole('button', { name: '确认生成 V2' }));

    expect(screen.getByText('已完成，V2')).toBeInTheDocument();
    const versionTrigger = screen.getByRole('button', { name: '已完成，V2' });
    expect(versionTrigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(versionTrigger.querySelector('.video-result-version-chevron')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '字幕' }));
    expect(screen.getByRole('textbox', { name: '字幕 2' })).toHaveValue('Welcome back to OpenCreator.');
  });

  it('saves manual subtitle edits while generating a new version', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=test' }
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '开始翻译' }));

    fireEvent.click(screen.getByRole('tab', { name: '字幕' }));
    fireEvent.change(screen.getByRole('textbox', { name: '字幕 1' }), {
      target: { value: 'The manually revised opening.' }
    });
    fireEvent.click(screen.getByRole('button', { name: '保存并生成 V2' }));

    const confirmation = screen.getByRole('group', { name: '确认生成新版本' });
    expect(confirmation).toHaveTextContent('将更新字幕、成片');
    expect(confirmation).toHaveTextContent('V1 的全部产出会保留');
    fireEvent.click(within(confirmation).getByRole('button', { name: '确认生成 V2' }));

    expect(screen.getByText('已完成，V2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '字幕' }));
    expect(screen.getByRole('textbox', { name: '字幕 1' })).toHaveValue('The manually revised opening.');
  });

  it('adds dubbing through settings and generates it in the next version', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=test' }
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '开始翻译' }));

    fireEvent.click(screen.getByRole('tab', { name: '配音' }));
    fireEvent.click(screen.getByRole('button', { name: '开启配音并生成新版本' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('switch', { name: '生成目标语言配音' }));
    fireEvent.click(screen.getByRole('button', { name: '返回 V1 成品' }));
    const regenerationRegion = screen.getByRole('region', { name: '生成新版本' });
    expect(regenerationRegion).toHaveTextContent('生成 V2');
    expect(regenerationRegion).not.toHaveTextContent('配置草稿');
    fireEvent.click(screen.getByRole('button', { name: '生成 V2' }));
    fireEvent.click(screen.getByRole('button', { name: '确认生成 V2' }));

    expect(screen.getByText('已完成，V2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '配音' }));
    expect(screen.getByText('配音文件已生成')).toBeInTheDocument();
    expect(screen.getByText('目标语言配音-V2.wav')).toBeInTheDocument();
  });

  it('returns to settings and creates a new version without replacing the old one', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=test' }
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '开始翻译' }));

    fireEvent.click(screen.getByRole('tab', { name: '字幕' }));
    fireEvent.change(screen.getByRole('textbox', { name: '字幕 1' }), {
      target: { value: 'Saved in the V1 artifact.' }
    });
    fireEvent.click(screen.getByRole('button', { name: '保存字幕' }));
    fireEvent.click(screen.getByRole('tab', { name: '任务设置' }));
    fireEvent.click(screen.getByRole('button', { name: '调整设置' }));
    fireEvent.change(screen.getByRole('combobox', { name: '翻译为' }), {
      target: { value: 'ja' }
    });
    fireEvent.click(screen.getByRole('button', { name: '添加视频' }));
    fireEvent.click(screen.getByRole('button', { name: '清除当前视频来源' }));
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=draft-source' }
    });

    expect(screen.getByText('正在基于 V1 调整')).toBeInTheDocument();
    expect(screen.getByText('原成品已保留，当前修改为配置草稿')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回 V1 成品' }));
    expect(screen.getByText('已完成，V1')).toBeInTheDocument();
    expect(screen.getByText('English，字幕文件')).toBeInTheDocument();
    expect(screen.getByTitle('YouTube 视频预览')).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/test'
    );

    fireEvent.click(screen.getByRole('tab', { name: '任务设置' }));
    fireEvent.click(screen.getByRole('button', { name: '调整设置' }));
    expect(screen.getByRole('combobox', { name: '翻译为' })).toHaveValue('ja');
    fireEvent.click(screen.getByRole('button', { name: '添加视频' }));
    expect(screen.getByTitle('YouTube 视频预览')).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/draft-source'
    );
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(screen.getByRole('combobox', { name: '翻译为' })).toHaveValue('ja');
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '生成 V2' }));

    expect(screen.getByText('已完成，V2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '已完成，V2' }));
    const versionMenu = screen.getByRole('menu');
    expect(within(versionMenu).getByText('已完成，V1')).toBeInTheDocument();
    expect(within(versionMenu).getByText('已完成，V2')).toBeInTheDocument();
    expect(versionMenu).toHaveTextContent('基于 V1 调整，当前查看');
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '已完成，V2' }));
    const reopenedVersionMenu = screen.getByRole('menu');
    fireEvent.click(within(reopenedVersionMenu).getByText('已完成，V1').closest('button') as HTMLButtonElement);

    expect(screen.getByText('已完成，V1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '任务设置' }));
    const settings = screen.getByText('目标语言').closest('dl');
    expect(settings).not.toBeNull();
    expect(within(settings as HTMLElement).getByText('English')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '字幕' }));
    expect(screen.getByRole('textbox', { name: '字幕 1' })).toHaveValue('Saved in the V1 artifact.');
  });

  it('resizes the immersive operation and Agent panes', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));

    const separator = screen.getByRole('separator', { name: '调整操作区和对话区宽度' });
    expect(separator).toHaveAttribute('aria-valuemin', '780');
    const layout = separator.parentElement as HTMLDivElement;
    vi.spyOn(layout, 'getBoundingClientRect').mockReturnValue({
      bottom: 800,
      height: 800,
      left: 0,
      right: 1200,
      top: 0,
      width: 1200,
      x: 0,
      y: 0,
      toJSON: () => ({})
    });

    fireEvent.mouseDown(separator, { button: 0, clientX: 800 });
    fireEvent.mouseMove(window, { clientX: 720 });
    fireEvent.mouseUp(window);
    expect(layout).toHaveStyle({ '--video-translation-pane-width': '780px' });

    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(layout).toHaveStyle({ '--video-translation-pane-width': '780px' });
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(layout).toHaveStyle({ '--video-translation-pane-width': '812px' });
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(layout).toHaveStyle({ '--video-translation-pane-width': '780px' });
    fireEvent.doubleClick(separator);
    expect(layout.style.getPropertyValue('--video-translation-pane-width')).toBe('');
  });

  it('supports local video, dubbing and vertical output options', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '打开视频翻译配音' }));

    const video = new File(['video'], 'demo.mp4', { type: 'video/mp4' });
    fireEvent.change(screen.getByLabelText('上传本地视频'), { target: { files: [video] } });
    expect(screen.getByText('本地视频 · 1 KB')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '视频链接' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清除当前视频来源' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除当前视频来源' }));
    expect(screen.getByRole('heading', { name: '拖放视频到这里' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '视频链接' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('上传本地视频'), { target: { files: [video] } });
    expect(within(screen.getByRole('region', { name: '视频预览' })).getByText('demo.mp4'))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(screen.getByRole('switch', { name: '优先使用平台字幕' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('switch', { name: '生成目标语言配音' }));
    fireEvent.click(screen.getByRole('switch', { name: '合成字幕视频' }));
    fireEvent.click(screen.getByRole('radio', { name: /9:16/ }));

    expect(screen.getByText('demo.mp4')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /声音代码/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /竖屏主标题/ })).toBeInTheDocument();
  });

  it('requires a video before advancing to translation settings', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));

    expect(screen.getByRole('alert')).toHaveTextContent('请先添加需要翻译的视频');
    expect(screen.getByRole('alert').parentElement).toHaveClass('video-translation-action-group');
    expect(screen.getByRole('heading', { name: '拖放视频到这里' })).toBeInTheDocument();
  });

  it('lets the Agent update and undo the shared translation draft', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=test' }
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));

    fireEvent.click(screen.getByRole('button', { name: '翻译成日语' }));
    expect(screen.getByRole('combobox', { name: '翻译为' })).toHaveValue('ja');
    expect(screen.getByRole('status')).toHaveTextContent('目标语言已改为日本語');

    fireEvent.click(screen.getByRole('button', { name: '撤销 Agent 修改' }));
    expect(screen.getByRole('combobox', { name: '翻译为' })).toHaveValue('en');
  });

  it('opens and highlights the matching left controls for Agent changes after generation', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=test' }
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    fireEvent.click(screen.getByRole('button', { name: '开始翻译' }));

    const composer = screen.getByRole('textbox', { name: '告诉 Agent 你的要求' });
    fireEvent.change(composer, { target: { value: '目标语言改成日语' } });
    fireEvent.keyDown(composer, { key: 'Enter' });

    expect(screen.getByRole('heading', { name: '设置翻译语言' })).toBeInTheDocument();
    const targetLanguageSelect = screen.getByRole('combobox', { name: '翻译为' });
    expect(targetLanguageSelect).toHaveValue('ja');
    expect(targetLanguageSelect.closest('.video-translation-field')).toHaveAttribute('data-agent-focus', 'true');

    fireEvent.change(composer, { target: { value: '开启配音' } });
    fireEvent.keyDown(composer, { key: 'Enter' });

    expect(screen.getByRole('heading', { name: '选择输出内容' })).toBeInTheDocument();
    const dubbingSwitch = screen.getByRole('switch', { name: '生成目标语言配音' });
    expect(dubbingSwitch).toBeChecked();
    expect(dubbingSwitch.closest('.video-translation-option-block')).toHaveAttribute('data-agent-focus', 'true');
    expect(screen.getByText('正在基于 V1 调整')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成 V2' })).toBeInTheDocument();
  });

  it('drives the translation task and version regeneration entirely from the conversation', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));

    const composer = screen.getByRole('textbox', { name: '告诉 Agent 你的要求' });
    fireEvent.change(composer, { target: { value: '开始翻译' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(screen.getByText('还缺少视频。请在对话中发送公开视频链接，或从左侧上传本地文件。'))
      .toBeInTheDocument();

    fireEvent.change(composer, {
      target: {
        value: '帮我翻译这个视频 https://www.youtube.com/watch?v=agent-test，目标语言日语，开启配音，输出竖屏'
      }
    });
    fireEvent.keyDown(composer, { key: 'Enter' });

    expect(screen.getByText('已完成，V1')).toBeInTheDocument();
    expect(screen.getByText('日本語，竖屏视频 9:16')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '配音' }));
    expect(screen.getByText('配音文件已生成')).toBeInTheDocument();

    fireEvent.change(composer, { target: { value: '把第1条字幕改为 OpenCreatorへようこそ。' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(screen.getByRole('textbox', { name: '字幕 1' })).toHaveValue('OpenCreatorへようこそ。');

    fireEvent.change(composer, { target: { value: '生成新版本' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(screen.getByRole('group', { name: '确认生成新版本' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认并执行 V2' }));

    expect(screen.getByText('已完成，V2')).toBeInTheDocument();
    expect(screen.getByText('V2 已生成完成，之前的版本仍可在版本历史中查看。')).toBeInTheDocument();
  });

  it('returns from the video translation workspace to the app directory', () => {
    const onWorkspaceModeChange = vi.fn();
    render(
      <DashboardPage
        onSelectPrompt={vi.fn()}
        onWorkspaceModeChange={onWorkspaceModeChange}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^视频翻译/ }));
    expect(onWorkspaceModeChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: '返回 Dashboard' }));

    expect(screen.getByRole('heading', { name: '精选应用' })).toBeInTheDocument();
    expect(onWorkspaceModeChange).toHaveBeenLastCalledWith(false);
  });

  it('filters apps by category and search query', () => {
    render(<DashboardPage onSelectPrompt={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: '音频处理' }));
    const directory = screen.getByRole('region', { name: '创作应用' });
    expect(within(directory).getByRole('button', { name: /^智能配音/ })).toBeInTheDocument();
    expect(directory.querySelectorAll('.dashboard-app-card')).toHaveLength(1);
    expect(within(directory).queryByRole('button', { name: /^视频翻译/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索应用' }), {
      target: { value: '不存在的应用' }
    });
    expect(screen.getByText('没有找到相关应用')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看全部应用' }));
    expect(screen.getByRole('tab', { name: '全部' })).toHaveAttribute('aria-selected', 'true');
  });

  it('selects a featured app prompt', () => {
    const onSelectPrompt = vi.fn();
    render(<DashboardPage onSelectPrompt={onSelectPrompt} />);

    fireEvent.click(screen.getByRole('button', { name: '打开数字人口播' }));
    expect(onSelectPrompt).toHaveBeenCalledWith(expect.stringContaining('数字人口播'));
  });
});
