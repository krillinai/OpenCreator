import { useState } from 'react';
import { Mic2 } from 'lucide-react';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import type { CreatorWorkspace } from '../dashboard/creator-workspace.js';

type CreatorSkillCategory = '最近' | '推荐' | '视频创作' | '数字人' | '图像设计' | '内容营销';

export type CreatorSkill = {
  id: string;
  title: string;
  category: string;
  image: string;
  interaction?: {
    type: 'workspace';
    workspace: CreatorWorkspace;
  };
  promptHint?: {
    zhCN: string;
    enUS: string;
  };
};

const creatorSkillCategories: CreatorSkillCategory[] = [
  '最近',
  '推荐',
  '视频创作',
  '数字人',
  '图像设计',
  '内容营销'
];

const creatorSkillsByCategory: Record<CreatorSkillCategory, CreatorSkill[]> = {
  最近: [],
  推荐: [
    {
      id: 'video-translation-multilingual',
      title: '多语言视频翻译',
      category: '视频翻译',
      image: '/dashboard/templates/video-translation-example.png',
      interaction: { type: 'workspace', workspace: 'video-translation' },
      promptHint: {
        zhCN: '上传视频，或者输入有效的视频链接',
        enUS: 'Upload a video or enter a valid video link'
      }
    },
    {
      id: 'avatar-presenter',
      title: '数字人口播',
      category: '数字人',
      image: '/dashboard/templates/digital-presenter.jpg'
    },
    {
      id: 'stickman-animation',
      title: '火柴人动画',
      category: '动画生成',
      image: '/dashboard/templates/ai-video-insane.jpg',
      interaction: { type: 'workspace', workspace: 'stickman-video' },
      promptHint: {
        zhCN: '选择、上传或生成角色，再描述故事和动画要求',
        enUS: 'Choose, upload, or generate a character, then describe the story'
      }
    },
    {
      id: 'creative-short-planning',
      title: '创意短片策划',
      category: '视频创作',
      image: '/dashboard/templates/animated-story.jpg'
    },
    {
      id: 'product-visual-poster',
      title: '产品视觉海报',
      category: '图像生成',
      image: '/skill-market/examples/nano-banana-pro-product-visual.png'
    }
  ],
  视频创作: [
    {
      id: 'narrative-short-video',
      title: '剧情短片',
      category: '故事视频',
      image: '/dashboard/templates/animated-story.jpg'
    },
    {
      id: 'product-ad-video',
      title: '商品广告短片',
      category: '商业视频',
      image: '/skill-market/examples/seedance-2-video-ad.png'
    },
    {
      id: 'stickman-explainer',
      title: '火柴人知识动画',
      category: '动画视频',
      image: '/dashboard/templates/ai-video-insane.jpg',
      interaction: { type: 'workspace', workspace: 'stickman-video' },
      promptHint: {
        zhCN: '选择角色并输入知识主题，我会先生成分镜',
        enUS: 'Choose a character and enter a topic to create the storyboard'
      }
    },
    {
      id: 'tutorial-demo-video',
      title: '教程演示视频',
      category: '教程视频',
      image: '/dashboard/templates/video-localization.jpg'
    },
    {
      id: 'short-video-script',
      title: '短视频脚本',
      category: '内容策划',
      image: '/skill-market/examples/gpt-image-2-info-poster.png'
    }
  ],
  数字人: [
    {
      id: 'avatar-knowledge-presenter',
      title: '知识分享口播',
      category: '知识博主',
      image: '/dashboard/templates/digital-presenter.jpg'
    },
    {
      id: 'avatar-course-lesson',
      title: '课程讲解',
      category: '在线课程',
      image: '/dashboard/templates/animated-story.jpg'
    },
    {
      id: 'avatar-product-introduction',
      title: '产品介绍',
      category: '产品讲解',
      image: '/skill-market/examples/nano-banana-pro-product-visual.png'
    },
    {
      id: 'avatar-news-presenter',
      title: '新闻播报',
      category: '资讯播报',
      image: '/dashboard/templates/video-translation-example.png'
    },
    {
      id: 'avatar-social-presenter',
      title: '社媒口播',
      category: '短视频口播',
      image: '/skill-market/examples/seedance-2-video-ad.png'
    }
  ],
  图像设计: [
    {
      id: 'video-thumbnail',
      title: '视频封面',
      category: '封面设计',
      image: '/dashboard/templates/ai-video-insane.jpg',
      interaction: { type: 'workspace', workspace: 'cover-generator' },
      promptHint: {
        zhCN: '描述封面，添加参考图，或者输入有效的 YouTube 链接',
        enUS: 'Describe the thumbnail, add a reference, or enter a valid YouTube link'
      }
    },
    {
      id: 'product-poster',
      title: '产品海报',
      category: '商业海报',
      image: '/skill-market/examples/nano-banana-pro-product-visual.png'
    },
    {
      id: 'infographic',
      title: '信息长图',
      category: '信息设计',
      image: '/skill-market/examples/gpt-image-2-info-poster.png'
    },
    {
      id: 'social-visuals',
      title: '社媒配图',
      category: '社交媒体',
      image: '/dashboard/templates/animated-story.jpg'
    },
    {
      id: 'portrait-series',
      title: '人物写真',
      category: '人物图像',
      image: '/dashboard/templates/digital-presenter.jpg'
    }
  ],
  内容营销: [
    {
      id: 'brand-story',
      title: '品牌故事',
      category: '品牌内容',
      image: '/dashboard/templates/animated-story.jpg'
    },
    {
      id: 'product-recommendation-video',
      title: '种草短视频',
      category: '社媒营销',
      image: '/skill-market/examples/seedance-2-video-ad.png'
    },
    {
      id: 'campaign-promotion',
      title: '活动推广',
      category: '活动营销',
      image: '/skill-market/examples/gpt-image-2-info-poster.png'
    },
    {
      id: 'product-launch',
      title: '新品发布',
      category: '产品营销',
      image: '/skill-market/examples/nano-banana-pro-product-visual.png'
    },
    {
      id: 'creator-weekly',
      title: '创作者周报',
      category: '粉丝运营',
      image: '/dashboard/templates/video-localization.jpg'
    }
  ]
};

export function CreatorDashboard(props: { onSelectSkill(skill: CreatorSkill): void }) {
  const { language, t } = useAppLanguage();
  const [selectedCategory, setSelectedCategory] = useState<CreatorSkillCategory>('推荐');
  const [recentSkills, setRecentSkills] = useState<CreatorSkill[]>([]);
  const skills = selectedCategory === '最近'
    ? recentSkills
    : creatorSkillsByCategory[selectedCategory];

  function selectSkill(skill: CreatorSkill) {
    setRecentSkills(current => [
      skill,
      ...current.filter(item => item.id !== skill.id)
    ].slice(0, 5));
    props.onSelectSkill(skill);
  }

  return (
    <div className="creator-dashboard">
      <div className="creator-template-tabs" role="tablist" aria-label={t('home.skillCategories')}>
        {creatorSkillCategories.map(category => (
          <button
            type="button"
            role="tab"
            aria-selected={selectedCategory === category}
            key={category}
            onClick={() => setSelectedCategory(category)}
          >
            {language === 'en-US' ? englishCreatorLabels[category] ?? category : category}
          </button>
        ))}
      </div>

      <section className="creator-dashboard-section" aria-labelledby="creator-templates-title">
        <div className="creator-dashboard-heading">
          <div>
            <h2 id="creator-templates-title">{t('home.skills')}</h2>
          </div>
          <Mic2 size={18} strokeWidth={1.7} aria-hidden="true" />
        </div>
        <div className="creator-template-grid">
          {skills.length === 0 ? (
            <p className="creator-template-empty">{t('home.noRecentSkills')}</p>
          ) : null}
          {skills.map(skill => (
            <button
              className="creator-template-card"
              type="button"
              key={skill.id}
              data-skill-id={skill.id}
              onClick={() => selectSkill(skill)}
              aria-label={t('home.useSkill', {
                title: language === 'en-US'
                  ? englishCreatorLabels[skill.title] ?? skill.title
                  : skill.title
              })}
            >
              <span className="creator-template-media">
                <img src={skill.image} alt="" loading="lazy" />
              </span>
              <span className="creator-template-copy">
                <small>{language === 'en-US'
                  ? englishCreatorLabels[skill.category] ?? skill.category
                  : skill.category}</small>
                <strong>{language === 'en-US'
                  ? englishCreatorLabels[skill.title] ?? skill.title
                  : skill.title}</strong>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

export function getCreatorSkillPromptHint(
  skill: CreatorSkill,
  language: 'zh-CN' | 'en-US'
): string {
  if (skill.promptHint !== undefined) {
    return language === 'en-US' ? skill.promptHint.enUS : skill.promptHint.zhCN;
  }
  const title = language === 'en-US'
    ? englishCreatorLabels[skill.title] ?? skill.title
    : skill.title;
  return language === 'en-US'
    ? `Describe what you want to create with ${title} and any requirements`
    : `描述你希望用「${title}」完成的内容和要求`;
}

const englishCreatorLabels: Record<string, string> = {
  最近: 'Recent',
  推荐: 'Recommended',
  视频创作: 'Video',
  数字人: 'Avatars',
  图像设计: 'Images',
  内容营销: 'Marketing',
  多语言视频翻译: 'Multilingual Video Translation',
  视频翻译: 'Video Translation',
  数字人口播: 'Digital Avatar',
  火柴人动画: 'Stick Figure Animation',
  动画生成: 'Animation',
  创意短片策划: 'Creative Short Planning',
  产品视觉海报: 'Product Visual Poster',
  图像生成: 'Image Generation',
  剧情短片: 'Narrative Short',
  故事视频: 'Story Video',
  商品广告短片: 'Product Ad',
  商业视频: 'Commercial Video',
  火柴人知识动画: 'Explainer Animation',
  动画视频: 'Animated Video',
  教程演示视频: 'Tutorial Video',
  教程视频: 'Tutorial',
  短视频脚本: 'Short Video Script',
  内容策划: 'Content Planning',
  知识分享口播: 'Knowledge Presenter',
  知识博主: 'Knowledge Creator',
  课程讲解: 'Course Lesson',
  在线课程: 'Online Course',
  产品介绍: 'Product Introduction',
  产品讲解: 'Product Demo',
  新闻播报: 'News Presenter',
  资讯播报: 'News',
  社媒口播: 'Social Presenter',
  短视频口播: 'Short Video Presenter',
  视频封面: 'Video Thumbnail',
  封面设计: 'Thumbnail Design',
  产品海报: 'Product Poster',
  商业海报: 'Commercial Poster',
  信息长图: 'Infographic',
  信息设计: 'Information Design',
  社媒配图: 'Social Visuals',
  社交媒体: 'Social Media',
  人物写真: 'Portrait Series',
  人物图像: 'Portraits',
  品牌故事: 'Brand Story',
  品牌内容: 'Brand Content',
  种草短视频: 'Product Recommendation Video',
  社媒营销: 'Social Marketing',
  活动推广: 'Campaign Promotion',
  活动营销: 'Campaign Marketing',
  新品发布: 'Product Launch',
  产品营销: 'Product Marketing',
  创作者周报: 'Creator Weekly',
  粉丝运营: 'Audience Growth'
};
