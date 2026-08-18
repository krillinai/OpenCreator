import { useState } from 'react';
import { Mic2 } from 'lucide-react';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';

type TemplateCategory = '最近' | '推荐' | '视频创作' | '数字人' | '图像设计' | '内容营销';

type CreatorTemplate = {
  title: string;
  category: string;
  image: string;
  prompt: string;
};

const templateCategories: TemplateCategory[] = [
  '最近',
  '推荐',
  '视频创作',
  '数字人',
  '图像设计',
  '内容营销'
];

const templatesByCategory: Record<TemplateCategory, CreatorTemplate[]> = {
  最近: [],
  推荐: [
    {
      title: '多语言视频翻译',
      category: '视频翻译',
      image: '/workbench/templates/video-translation-example.png',
      prompt: '使用多语言视频翻译模板处理我的视频，识别原语言，并生成自然的目标语言字幕和配音。'
    },
    {
      title: '数字人口播',
      category: '数字人',
      image: '/workbench/templates/digital-presenter.jpg',
      prompt: '使用数字人口播模板制作一支专业的讲解视频，请先帮我完善口播稿和镜头节奏。'
    },
    {
      title: '火柴人动画',
      category: '动画生成',
      image: '/workbench/templates/ai-video-insane.jpg',
      prompt: '使用火柴人动画模板，把我的主题制作成一支有明确故事和动作节奏的动画短片。'
    },
    {
      title: '创意短片策划',
      category: '视频创作',
      image: '/workbench/templates/animated-story.jpg',
      prompt: '使用创意短片策划模板，把我的内容主题整理成创意方向、镜头脚本和拍摄清单。'
    },
    {
      title: '产品视觉海报',
      category: '图像生成',
      image: '/skill-market/examples/nano-banana-pro-product-visual.png',
      prompt: '使用产品视觉海报模板，根据我的产品信息和图片生成一套有品牌感的主视觉。'
    }
  ],
  视频创作: [
    {
      title: '剧情短片',
      category: '故事视频',
      image: '/workbench/templates/animated-story.jpg',
      prompt: '使用剧情短片模板，把我的主题扩展成故事大纲、人物关系、分镜和完整视频方案。'
    },
    {
      title: '商品广告短片',
      category: '商业视频',
      image: '/skill-market/examples/seedance-2-video-ad.png',
      prompt: '使用商品广告短片模板，根据我的产品素材制作一支节奏明快的短视频广告。'
    },
    {
      title: '火柴人知识动画',
      category: '动画视频',
      image: '/workbench/templates/ai-video-insane.jpg',
      prompt: '使用火柴人知识动画模板，把我的知识主题拆成简单易懂的动画场景和旁白。'
    },
    {
      title: '教程演示视频',
      category: '教程视频',
      image: '/workbench/templates/video-localization.jpg',
      prompt: '使用教程演示视频模板，把我的操作流程整理成步骤清晰的脚本、画面和解说。'
    },
    {
      title: '短视频脚本',
      category: '内容策划',
      image: '/skill-market/examples/gpt-image-2-info-poster.png',
      prompt: '使用短视频脚本模板，为我的主题生成开场钩子、内容结构、镜头说明和结尾引导。'
    }
  ],
  数字人: [
    {
      title: '知识分享口播',
      category: '知识博主',
      image: '/workbench/templates/digital-presenter.jpg',
      prompt: '使用知识分享口播模板，把我的知识内容整理成自然、有重点的数字人口播视频。'
    },
    {
      title: '课程讲解',
      category: '在线课程',
      image: '/workbench/templates/animated-story.jpg',
      prompt: '使用课程讲解模板，规划数字人讲解稿、章节结构、重点提示和配套画面。'
    },
    {
      title: '产品介绍',
      category: '产品讲解',
      image: '/skill-market/examples/nano-banana-pro-product-visual.png',
      prompt: '使用数字人产品介绍模板，突出产品卖点、使用场景和行动引导。'
    },
    {
      title: '新闻播报',
      category: '资讯播报',
      image: '/workbench/templates/video-translation-example.png',
      prompt: '使用数字人新闻播报模板，把我的资讯内容改写成准确、简洁的播报稿和视频方案。'
    },
    {
      title: '社媒口播',
      category: '短视频口播',
      image: '/skill-market/examples/seedance-2-video-ad.png',
      prompt: '使用社媒口播模板，生成适合短视频平台的数字人口播稿、节奏和画面建议。'
    }
  ],
  图像设计: [
    {
      title: '视频封面',
      category: '封面设计',
      image: '/workbench/templates/ai-video-insane.jpg',
      prompt: '使用视频封面模板，根据我的视频主题设计醒目的标题层级、主体画面和构图。'
    },
    {
      title: '产品海报',
      category: '商业海报',
      image: '/skill-market/examples/nano-banana-pro-product-visual.png',
      prompt: '使用产品海报模板，根据我的产品素材生成有明确卖点和品牌感的海报。'
    },
    {
      title: '信息长图',
      category: '信息设计',
      image: '/skill-market/examples/gpt-image-2-info-poster.png',
      prompt: '使用信息长图模板，把我的内容整理成层级清晰、适合分享的视觉长图。'
    },
    {
      title: '社媒配图',
      category: '社交媒体',
      image: '/workbench/templates/animated-story.jpg',
      prompt: '使用社媒配图模板，为我的内容生成一组风格统一、适合发布的图片。'
    },
    {
      title: '人物写真',
      category: '人物图像',
      image: '/workbench/templates/digital-presenter.jpg',
      prompt: '使用人物写真模板，根据我的人物素材生成自然、有质感的系列写真。'
    }
  ],
  内容营销: [
    {
      title: '品牌故事',
      category: '品牌内容',
      image: '/workbench/templates/animated-story.jpg',
      prompt: '使用品牌故事模板，把我的品牌背景、理念和用户价值整理成有感染力的内容。'
    },
    {
      title: '种草短视频',
      category: '社媒营销',
      image: '/skill-market/examples/seedance-2-video-ad.png',
      prompt: '使用种草短视频模板，根据产品特点生成真实自然的体验脚本、镜头和发布文案。'
    },
    {
      title: '活动推广',
      category: '活动营销',
      image: '/skill-market/examples/gpt-image-2-info-poster.png',
      prompt: '使用活动推广模板，为我的活动生成传播主题、视觉方向、短视频和社媒文案。'
    },
    {
      title: '新品发布',
      category: '产品营销',
      image: '/skill-market/examples/nano-banana-pro-product-visual.png',
      prompt: '使用新品发布模板，规划产品亮点、发布节奏、视觉内容和不同渠道的文案。'
    },
    {
      title: '创作者周报',
      category: '粉丝运营',
      image: '/workbench/templates/video-localization.jpg',
      prompt: '使用创作者周报模板，把我本周的内容、进展和下周计划整理成适合粉丝阅读的周报。'
    }
  ]
};

export function CreatorWorkbench(props: { onSelectPrompt(prompt: string): void }) {
  const { language, t } = useAppLanguage();
  const [selectedCategory, setSelectedCategory] = useState<TemplateCategory>('推荐');
  const [recentTemplates, setRecentTemplates] = useState<CreatorTemplate[]>([]);
  const templates = selectedCategory === '最近'
    ? recentTemplates
    : templatesByCategory[selectedCategory];

  function selectTemplate(template: CreatorTemplate) {
    setRecentTemplates(current => [
      template,
      ...current.filter(item => item.title !== template.title)
    ].slice(0, 5));
    props.onSelectPrompt(template.prompt);
  }

  return (
    <div className="creator-workbench">
      <div className="creator-template-tabs" role="tablist" aria-label={t('home.templateCategories')}>
        {templateCategories.map(category => (
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

      <section className="creator-workbench-section" aria-labelledby="creator-templates-title">
        <div className="creator-workbench-heading">
          <div>
            <h2 id="creator-templates-title">{t('home.templates')}</h2>
          </div>
          <Mic2 size={18} strokeWidth={1.7} aria-hidden="true" />
        </div>
        <div className="creator-template-grid">
          {templates.length === 0 ? (
            <p className="creator-template-empty">{t('home.noRecentTemplates')}</p>
          ) : null}
          {templates.map(template => (
            <button
              className="creator-template-card"
              type="button"
              key={template.title}
              onClick={() => selectTemplate(template)}
              aria-label={t('home.useTemplate', {
                title: language === 'en-US'
                  ? englishCreatorLabels[template.title] ?? template.title
                  : template.title
              })}
            >
              <span className="creator-template-media">
                <img src={template.image} alt="" loading="lazy" />
              </span>
              <span className="creator-template-copy">
                <small>{language === 'en-US'
                  ? englishCreatorLabels[template.category] ?? template.category
                  : template.category}</small>
                <strong>{language === 'en-US'
                  ? englishCreatorLabels[template.title] ?? template.title
                  : template.title}</strong>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
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
