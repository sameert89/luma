import { t } from '../../lib/i18n'
import {
  ArrowDown,
  Bookmark,
  Captions,
  Check,
  ChevronDown,
  CircleFadingArrowUp,
  CopyCheck,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  Clapperboard,
  Download,
  EllipsisVertical,
  Eye,
  EyeOff,
  FileInput,
  Film,
  FileImage,
  FolderOpen,
  Heart,
  HeartCrack,
  ImageMinus,
  Images,
  Info,
  ListVideo,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Plus,
  Presentation,
  RefreshCw,
  Search,
  Settings,
  Settings2,
  Shuffle,
  Sparkles,
  SlidersHorizontal,
  Tag,
  Timer,
  Trash2,
  Volume2,
  VolumeX,
  X,
  type LucideIcon,
} from 'lucide-react'

/**
 * One documented control. `icons` are the same Lucide components the live control renders
 * (two for toggles that swap icons); `label` is the visible text of a control that has none,
 * and `progressBar` draws the thumbnail progress indicator, which has neither.
 */
export type GuideEntry = {
  name: string
  where: string
  what: string
  code?: string
  icons?: LucideIcon[]
  label?: string
  progressBar?: boolean
}
export type GuideGroup = { title: string; entries: GuideEntry[] }
export type GuideSection = { id: string; title: string; summary: string; groups: GuideGroup[]; notes?: string[] }

export const guideSections: GuideSection[] = [
  {
    id: 'setup',
    title: t('help:guide.librariesSetupAndAdministration'),
    summary: t('help:guide.configureRootsEnableFileManagementAndChooseComicLocations'),
    groups: [
      {
        title: t('help:guide.howLibrariesWork'),
        entries: [
          {
            icons: [Settings],
            name: t('help:guide.aLibraryIsAMountedServerRoot'),
            where: t('help:guide.serverDockerConfiguration'),
            what: t('help:guide.lumaReadsExistingMediaInDirectoriesMountedIntoThe'),
            code: 'environment:\n  Luma__Indexing__Libraries__0__Id: "1"\n  Luma__Indexing__Libraries__0__Name: "Photos"\n  Luma__Indexing__Libraries__0__Path: "/media"\n  Luma__Indexing__Libraries__1__Id: "2"\n  Luma__Indexing__Libraries__1__Name: "Comics"\n  Luma__Indexing__Libraries__1__Path: "/comics"\nvolumes:\n  - /your/photos:/media:ro\n  - /your/comics:/comics:ro',
          },
          {
            icons: [Settings],
            name: t('help:guide.stableLibraryIDsAndIndexing'),
            where: t('help:guide.galleryHomeLibrarySetup'),
            what: t('help:guide.useConsecutiveConfigurationIndexesStartingAt0ButKeep'),
          },
        ],
      },
      {
        title: t('help:guide.enableFileManagement'),
        entries: [
          {
            icons: [Settings],
            name: t('help:guide.enableTheFileManagementSwitch'),
            where: t('help:guide.dockerEnvironmentThenSettingsGeneralFileManagement'),
            what: t('help:guide.turnOnEnableFileManagementInSettingsGeneralFile'),
            code: 'environment:\n  Luma__Files__Enabled: "true"\n  Luma__PublicOrigin: "https://luma.example.com"\n  Luma__Indexing__Libraries__0__Writable: "true"\nvolumes:\n  - /your/photos:/media:rw',
          },
          {
            icons: [Settings],
            name: t('help:guide.readOnlyStartupWarningAndRecheck'),
            where: t('help:guide.startupBannerSettingsGeneralFileManagement'),
            what: t('help:guide.lumaChecksWriteAccessAtStartupAndWhenEnabling'),
          },
        ],
      },
      {
        title: t('help:guide.panelsComicLocations'),
        entries: [
          {
            icons: [Settings],
            name: t('help:guide.setUpTheBookshelf'),
            where: t('help:guide.panelsComicLocations2'),
            what: t('help:guide.theEmptyStartPageHasAddComicLocationIt'),
          },
          {
            icons: [Settings],
            name: t('help:guide.excludeComicImagesFromGallery'),
            where: t('help:guide.comicLocationsExcludeFromGallery'),
            what: t('help:guide.checkedByDefaultForEachComicLocationIncludingExisting'),
          },
          {
            icons: [Settings],
            name: t('help:guide.revisitAndChangeLocations'),
            where: t('help:guide.panelsBookshelfComicLocations'),
            what: t('help:guide.thePanelsStartPageShowsUpToFiveRecently'),
          },
        ],
      },
      {
        title: t('help:guide.deploymentDefaultsAndApplicationToggles'),
        entries: [
          {
            icons: [Settings],
            name: t('help:guide.enableOrHideApplications'),
            where: t('help:guide.settingsGeneralApplications'),
            what: t('help:guide.galleryIsAlwaysAvailableEnableOrHideFlickAnd'),
          },
          {
            icons: [Settings],
            name: t('help:guide.reproduceInterfacePreferences'),
            where: t('help:guide.dockerEnvironment'),
            what: t('help:guide.deploymentPreferenceKeys'),
            code: `environment:\n  Luma__Ui__FlickEnabled: "true"\n  Luma__Ui__PanelsEnabled: "true"\n  Luma__Ui__Preferences__luma-theme: "forest"\n  Luma__Ui__Preferences__luma-appearance-v2: '{"background":"aurora","blur":4,"opacity":0.7,"darkness":0.1,"motion":"system","splashes":true}'\n  Luma__Ui__Preferences__luma-reels-sort: '{"sort":"modified","order":"desc"}'\n  Luma__Ui__Preferences__luma-reels-state: '{"muted":true,"autoScroll":false}'\n  Luma__Ui__Preferences__luma-panels-reader-defaults: '{"mode":"single","fit":"screen","direction":"ltr"}'\n  Luma__Panels__Sources__0__LibraryId: "2"\n  Luma__Panels__Sources__0__RelativePath: "Manga"\n  Luma__Panels__Sources__0__ImageFolders: "false"`,
          },
        ],
      },
    ],
    notes: [t('help:guide.backUpSQLiteAndOriginalStagingTrashMediaAt')],
  },
  {
    id: 'v2-apps',
    title: t('help:guide.luma20ApplicationsAndFiles'),
    summary: t('help:guide.switchApplicationsManageWritableLibrariesUploadAndRecoverFiles'),
    groups: [
      {
        title: t('help:guide.applicationsAndFileManagement'),
        entries: [
          {
            label: t('help:guide.lumaLogo'),
            name: t('help:guide.applicationSwitcher'),
            where: t('help:guide.topLeftLumaLogo'),
            what: t('help:guide.clickTheLumaLogoToChooseGalleryFlickOr'),
          },
          {
            label: t('help:guide.panels'),
            name: t('help:guide.comicLibraryAndReader'),
            where: t('help:guide.lumaLogoPanels'),
            what: t('help:guide.searchComicTitlesOrSeriesFilterBySeriesComic'),
          },
          {
            label: t('help:guide.fileManagement'),
            name: t('help:guide.fileAndFolderChanges'),
            where: t('help:guide.galleryInsideAConfiguredWritableLibrary'),
            what: t('help:guide.useTheFileManagementIconBesideSelectToReveal'),
          },
          {
            label: t('help:guide.uploadFilesUploadFolder'),
            name: t('help:guide.resumableUploads'),
            where: t('help:guide.galleryFileManagementUpload'),
            what: t('help:guide.theUploadDialogHasChooseFilesChooseFolderAnd'),
          },
          {
            label: t('help:guide.recycleBin'),
            name: t('help:guide.restoreOrPermanentlyRemoveRecycledItems'),
            where: t('help:guide.topOfSettingsRecycleBin'),
            what: t('help:guide.chooseAWritableLibraryShowsOriginalPathsAndDeletion'),
          },
          {
            label: t('help:guide.needsAttention'),
            name: t('help:guide.interruptedFileOperationRecovery'),
            where: t('help:guide.backgroundJobsAnOperationNeedingAttention'),
            what: t('help:guide.reviewSourceStagingAndDestinationEvidenceThenExplicitlyChoose'),
          },
        ],
      },
    ],
  },
  {
    id: 'libraries',
    title: t('help:guide.librariesFoldersAndGallery'),
    summary: t('help:guide.browseFilterSortSelectAndHideFolders'),
    groups: [
      {
        title: t('help:guide.gettingAround'),
        entries: [
          {
            icons: [Images],
            name: t('help:guide.library'),
            where: t('help:guide.bottomBarOnPhonesSideNavigationOnWiderScreens'),
            what: t('help:guide.returnsToLibraryBrowsingWithYourCurrentFolderAnd'),
          },
          {
            label: t('help:guide.luma'),
            name: t('help:guide.lumaHome'),
            where: t('help:guide.topLeftOfTheHeader'),
            what: t('help:guide.clearsEveryFilterAndReturnsToYourLibraries'),
          },
          {
            icons: [FolderOpen],
            name: t('help:guide.openALibraryOrFolder'),
            where: t('help:guide.libraryCardsOnYourLibrariesFolderCardsAtThe'),
            what: t('help:guide.opensItALibraryWithNothingIndexedAsksHow'),
          },
          {
            icons: [ChevronRight],
            name: t('help:guide.folderBreadcrumb'),
            where: t('help:guide.underTheFolderTitleInsideASubfolder'),
            what: t('help:guide.jumpsStraightBackToAnyParentFolder'),
          },
          {
            label: t('help:guide.previousFolders'),
            name: t('help:guide.previousFoldersNextFolders'),
            where: t('help:guide.belowTheFolderCardsInFoldersWithManySubfolders'),
            what: t('help:guide.pagesThroughTheSubfolders'),
          },
          {
            label: t('help:guide.loadMore'),
            name: t('help:guide.loadMore'),
            where: t('help:guide.bottomOfALongGallery'),
            what: t('help:guide.loadsTheNextPageOfResultsScrollingToThe'),
          },
        ],
      },
      {
        title: t('help:guide.indexing'),
        entries: [
          {
            label: t('help:guide.indexFoldersAsIOpenThem'),
            name: t('help:guide.setUpLibrary'),
            where: t('help:guide.opensWhenYouChooseALibraryThatHasNot'),
            what: t('help:guide.chooseAutomaticTagImportSeparatelyFromInitialDiscoveryLazy'),
          },
          {
            icons: [RefreshCw],
            name: t('help:guide.backgroundJobs'),
            where: t('help:guide.topRightHeaderInGalleryAndPanels'),
            what: t('help:guide.opensTheListOfIndexingImportAndExportJobs'),
          },
          {
            icons: [ArrowDown],
            name: t('help:guide.pullToRefresh'),
            where: t('help:guide.topOfAGalleryOnTouchScreens'),
            what: t('help:guide.dragTheGalleryDownFromTheTopToLoad'),
          },
        ],
      },
      {
        title: t('help:guide.folderAndGalleryMenus'),
        entries: [
          {
            icons: [EllipsisVertical],
            name: t('help:guide.folderActions'),
            where: t('help:guide.onEveryFolderAndLibraryCardAndInThe'),
            what: t('help:guide.opensTheFolderMenuALibraryIsItsTop'),
          },
          {
            icons: [RefreshCw],
            name: t('help:guide.rescanFolderRescanLibrary'),
            where: t('help:guide.folderActionsMenu'),
            what: t('help:guide.checksTheFolderAndEveryFolderInsideItOr'),
          },
          {
            icons: [EllipsisVertical],
            name: t('help:guide.galleryActions'),
            where: t('help:guide.headerOfSearchResultsAndOtherViewsOutsideA'),
            what: t('help:guide.slideshowSelectionRefreshAndFilterActionsForTheCurrent'),
          },
          {
            label: t('help:guide.startSlideshow'),
            name: t('help:guide.startSlideshow'),
            where: t('help:guide.folderOrGalleryActionsMenu'),
            what: t('help:guide.opensTheFirstResultInTheViewerAndAdvances'),
          },
          {
            label: t('help:guide.refreshCollection'),
            name: t('help:guide.refreshCollection'),
            where: t('help:guide.folderOrGalleryActionsMenu'),
            what: t('help:guide.reloadsWhatIsShownFromLumaSIndexIt'),
          },
          {
            icons: [Info],
            name: t('help:guide.folderInformation'),
            where: t('help:guide.folderActionsMenu'),
            what: t('help:guide.showsTheFolderSNameLibraryAndLocation'),
          },
          {
            icons: [FileInput],
            name: t('help:guide.importFolderMetadata'),
            where: t('help:guide.folderActionsMenu'),
            what: t('help:guide.mergesEXIFXMPTagsFromEveryIndexedFileIn'),
          },
          {
            icons: [ImageMinus],
            name: t('help:guide.resetAlbumCover'),
            where: t('help:guide.folderActionsMenuWhenYouPickedTheFolderS'),
            what: t('help:guide.forgetsYourCoverChoiceSoTheFolderGoesBack'),
          },
          {
            icons: [EyeOff],
            name: t('help:guide.hideFolder'),
            where: t('help:guide.folderActionsMenuForFoldersInsideALibraryNot'),
            what: t('help:guide.leavesTheFolderAndEverythingInItOutOf'),
          },
          {
            label: t('help:guide.useAsFolderCover'),
            name: t('help:guide.useAsFolderCoverUseAsLibraryCover'),
            where: t('help:guide.mediaDetailsInTheViewer'),
            what: t('help:guide.makesTheOpenItemTheCoverArtForIts'),
          },
        ],
      },
      {
        title: t('help:guide.filtersAndSorting'),
        entries: [
          {
            icons: [SlidersHorizontal],
            name: t('help:guide.filters'),
            where: t('help:guide.headerRightOfSearchInGalleryAndFlick'),
            what: t('help:guide.opensFiltersAndSortingToLimitResultsByFolder'),
          },
          {
            label: t('help:guide.editFilters'),
            name: t('help:guide.editFilters'),
            where: t('help:guide.folderOrGalleryActionsMenu'),
            what: t('help:guide.opensTheSameFiltersAndSortingSheet'),
          },
          {
            label: t('help:guide.hideFilters'),
            name: t('help:guide.hideFiltersShowFilters'),
            where: t('help:guide.folderOrGalleryActionsMenu'),
            what: t('help:guide.hidesOrShowsTheRowOfActiveFiltersUnder'),
          },
          {
            label: t('help:guide.tagsBeach'),
            name: t('help:guide.activeFilterChip'),
            where: t('help:guide.activeFilterRowUnderTheHeader'),
            what: t('help:guide.removesThatOneFilterRemovingTheLibraryAlsoRemoves'),
          },
          {
            label: t('help:guide.clearAllFilters'),
            name: t('help:guide.clearAllFilters'),
            where: t('help:guide.endOfTheActiveFilterRowAndTheFolder'),
            what: t('help:guide.removesEveryFilterIncludingLibraryAndFolderScopeSo'),
          },
          {
            label: t('help:guide.sortBy'),
            name: t('help:guide.sortByAndSortDirection'),
            where: t('help:guide.filtersAndSortingOrderAndGrouping'),
            what: t('help:guide.ordersMediaByModifiedDateCapturedDateNameType'),
          },
          {
            label: t('help:guide.reshuffle'),
            name: t('help:guide.reshuffle'),
            where: t('help:guide.filtersAndSortingWhenSortByIsShuffle'),
            what: t('help:guide.picksANewRandomOrderTheSameShuffleStays'),
          },
          {
            label: t('help:guide.groupBy'),
            name: t('help:guide.groupBy'),
            where: t('help:guide.filtersAndSortingOrderAndGrouping'),
            what: t('help:guide.groupsResultsUnderTagFolderDateOrTypeHeadings'),
          },
          {
            label: t('help:guide.clearFolderScope'),
            name: t('help:guide.clearFolderScopeIncludeSubfolders'),
            where: t('help:guide.filtersAndSortingLocationAndName'),
            what: t('help:guide.dropsTheFolderLimitOrIncludesEverythingBelowThe'),
          },
          {
            label: t('help:guide.resetFilters'),
            name: t('help:guide.applyFiltersResetFilters'),
            where: t('help:guide.bottomOfFiltersAndSorting'),
            what: t('help:guide.applyUsesYourChangesResetRemovesEveryFilterAt'),
          },
        ],
      },
      {
        title: t('help:guide.selectingMedia'),
        entries: [
          {
            icons: [CopyCheck, Check],
            name: t('help:guide.selectMediaDoneSelecting'),
            where: t('help:guide.besideTheFolderOrGalleryActionsButton'),
            what: t('help:guide.showsACheckboxOnEachThumbnailSelectUpTo'),
          },
          {
            icons: [Tag],
            name: t('help:guide.editTags'),
            where: t('help:guide.selectionBarOnceItemsAreSelected'),
            what: t('help:guide.addsOrRemovesOneTagOnEverySelectedItem'),
          },
          {
            icons: [X],
            name: t('help:guide.clearSelection'),
            where: t('help:guide.selectionBar'),
            what: t('help:guide.deselectsEverything'),
          },
        ],
      },
    ],
    notes: [
      t('help:guide.foldersFollowTheSelectedDirectionDateSortsOrderFolders'),
      t('help:guide.refreshCollectionOnlyReloadsWhatLumaHasAlreadyIndexed'),
      t('help:guide.hidingTheActiveFilterRowOnlyHidesItUse'),
    ],
  },
  {
    id: 'search',
    title: t('help:guide.searchTagsAndCollections'),
    summary: t('help:guide.findMediaTagItAndMarkFavourites'),
    groups: [
      {
        title: t('help:guide.search'),
        entries: [
          {
            icons: [Search],
            name: t('help:guide.search'),
            where: t('help:guide.headerSearchFieldInGalleryCollectionsFlickAndPanels'),
            what: t('help:guide.searchesFileNamesFoldersAndTagsWithinTheCurrent'),
          },
          {
            icons: [Tag, FolderOpen, FileImage],
            name: t('help:guide.searchSuggestions'),
            where: t('help:guide.belowTheSearchFieldAsYouType'),
            what: t('help:guide.completesTagsFoldersAndFileNamesFromYourWhole'),
          },
          {
            icons: [Search, X],
            name: t('help:guide.openSearchCloseSearch'),
            where: t('help:guide.headerOnPhones'),
            what: t('help:guide.phoneSearchStartsCollapsedSearchFiltersAndSettingsAre'),
          },
          {
            icons: [Search],
            name: t('help:guide.clearSearch'),
            where: t('help:guide.searchField'),
            what: t('help:guide.deleteTheTextWithYourKeyboardAndSubmitThe'),
          },
        ],
      },
      {
        title: t('help:guide.tags'),
        entries: [
          {
            icons: [Plus],
            name: t('help:guide.findOrCreateATag'),
            where: t('help:guide.tagsInMediaDetailsTheFlickTagsSheetAnd'),
            what: t('help:guide.matchingTagsListBelowTheFieldAsYouType'),
          },
          {
            label: t('help:guide.beach'),
            name: t('help:guide.removeTag'),
            where: t('help:guide.tagListForTheOpenItem'),
            what: t('help:guide.removesThatTagFromThisItemOnly'),
          },
          {
            label: t('help:guide.applyTo3Items'),
            name: t('help:guide.bulkTagOperation'),
            where: t('help:guide.editTagsForASelection'),
            what: t('help:guide.chooseAddATagOrRemoveATagThen'),
          },
        ],
      },
      {
        title: t('help:guide.favourites'),
        entries: [
          {
            icons: [Heart],
            name: t('help:guide.like'),
            where: t('help:guide.actionRowInTheViewerAndFlickAndMedia'),
            what: t('help:guide.marksTheItemAsAFavouritePressAgainTo'),
          },
          {
            icons: [HeartCrack],
            name: t('help:guide.dislike'),
            where: t('help:guide.actionRowInTheViewerAndFlickAndMedia'),
            what: t('help:guide.marksTheItemAsDislikedPressAgainToReturn'),
          },
          {
            label: t('help:guide.favouriteState'),
            name: t('help:guide.favouriteStateFilter'),
            where: t('help:guide.filtersAndSortingMedia'),
            what: t('help:guide.showsOnlyFavouritesHiddenDislikedOrUnratedItems'),
          },
        ],
      },
      {
        title: t('help:guide.collections'),
        entries: [
          {
            icons: [Bookmark],
            name: t('help:guide.collections'),
            where: t('help:guide.bottomBarOrSideNavigation'),
            what: t('help:guide.listsYourFavouritesAndEveryTagOpeningItStarts'),
          },
          {
            icons: [Heart],
            name: t('help:guide.openFavourites'),
            where: t('help:guide.collectionsFavourites'),
            what: t('help:guide.showsEveryLikedItem'),
          },
          {
            icons: [Tag],
            name: t('help:guide.tag'),
            where: t('help:guide.collectionsTags'),
            what: t('help:guide.showsEveryItemWithThatTagPressAndHold'),
          },
          {
            icons: [EllipsisVertical],
            name: t('help:guide.manageTag'),
            where: t('help:guide.besideEachTagInCollections'),
            what: t('help:guide.renameTheTagRenamingToAnotherTagSName'),
          },
        ],
      },
    ],
    notes: [t('help:guide.likeAndDislikeAreTogglesAHighlightedHeartMeans')],
  },
  {
    id: 'viewer',
    title: t('help:guide.photoAndVideoViewer'),
    summary: t('help:guide.openAFileNavigateViewDetailsAndPlayVideo'),
    groups: [
      {
        title: t('help:guide.viewerControls'),
        entries: [
          {
            icons: [Presentation, Pause],
            name: t('help:guide.slideshow'),
            where: t('help:guide.topRightOfTheViewer'),
            what: t('help:guide.startsOrPausesASlideshowPhotosAdvanceOnA'),
          },
          {
            label: '5 s',
            name: t('help:guide.slideDuration'),
            where: t('help:guide.besideSlideshowWhileItRuns'),
            what: t('help:guide.cyclesThrough3510And20SecondsPer'),
          },
          {
            icons: [X],
            name: t('help:guide.closeViewer'),
            where: t('help:guide.topRightOfTheViewer'),
            what: t('help:guide.returnsToTheLastItemViewedInTheCurrent'),
          },
          {
            icons: [EllipsisVertical, X],
            name: t('help:guide.viewerMenu'),
            where: t('help:guide.bottomRightBesideLikeAndDislike'),
            what: t('help:guide.opensOrClosesTheMenuOfActionsAboveIt'),
          },
          {
            icons: [Settings2],
            name: t('help:guide.viewOptions'),
            where: t('help:guide.viewerMenu'),
            what: t('help:guide.fitOrFillZoomActualSizeRotatePlaybackSpeed'),
          },
          {
            icons: [Trash2],
            name: t('help:guide.deleteFile'),
            where: t('help:guide.galleryViewerExpandedViewerMenu'),
            what: t('help:guide.confirmRecyclingOfTheDisplayedPhotoOrVideoOr'),
          },
          {
            icons: [Info],
            name: t('help:guide.mediaDetails'),
            where: t('help:guide.viewerMenu'),
            what: t('help:guide.likeAndDislikeTagsCoverChoicesMetadataImportAnd'),
          },
          {
            icons: [Clapperboard],
            name: t('help:guide.watchOnFlick'),
            where: t('help:guide.viewerMenuForVideosAndGIFs'),
            what: t('help:guide.continuesInFlickStartingAtThisItemWithThe'),
          },
          {
            icons: [ChevronLeft, ChevronRight],
            name: t('help:guide.previousItemNextItem'),
            where: t('help:guide.viewerMenu'),
            what: t('help:guide.movesThroughTheCurrentResultsInTheirSortedOrder'),
          },
        ],
      },
      {
        title: t('help:guide.viewOptions'),
        entries: [
          {
            label: t('help:guide.fill'),
            name: t('help:guide.fitFill'),
            where: t('help:guide.viewOptions'),
            what: t('help:guide.showsTheWholeItemOrFillsTheScreenAnd'),
          },
          {
            label: '100%',
            name: t('help:guide.zoomOutResetZoomZoomIn'),
            where: t('help:guide.viewOptionsForPhotos'),
            what: t('help:guide.theAndButtonsZoomThePercentageReturnsToFit'),
          },
          {
            label: t('help:guide.actualSize'),
            name: t('help:guide.actualSize'),
            where: t('help:guide.viewOptionsForPhotos'),
            what: t('help:guide.loadsTheOriginalFileAndShowsItPixelFor'),
          },
          {
            label: t('help:guide.rotate'),
            name: t('help:guide.rotate'),
            where: t('help:guide.viewOptionsForPhotos'),
            what: t('help:guide.turnsThePicture90OnScreenOnlyTheFile'),
          },
          {
            icons: [Maximize],
            name: t('help:guide.fullscreen'),
            where: t('help:guide.viewOptionsAndTheVideoControlBar'),
            what: t('help:guide.fillsTheScreenControlsFadeWhileMediaPlaysAnd'),
          },
          {
            icons: [Minimize],
            name: t('help:guide.exitFullscreen'),
            where: t('help:guide.topRightInFullscreenOrTheVideoControlBar'),
            what: t('help:guide.leavesFullscreen'),
          },
          {
            icons: [Download],
            name: t('help:guide.download'),
            where: t('help:guide.viewOptions'),
            what: t('help:guide.downloadsTheOriginalFile'),
          },
          {
            label: t('help:guide.copyStreamURL'),
            name: t('help:guide.copyStreamURL'),
            where: t('help:guide.viewOptionsForVideos'),
            what: t('help:guide.copiesTheVideoSAddressForVLCOrAnother'),
          },
        ],
      },
      {
        title: t('help:guide.videoPlayback'),
        entries: [
          {
            icons: [Captions],
            name: t('help:guide.captionsCC'),
            where: t('help:guide.videoPlaybackBarAboveItOnSmallerScreensLower'),
            what: t('help:guide.turnsCaptionsOnOrOffForTheCurrentVideo'),
          },
          {
            label: t('help:guide.captionSettings'),
            name: t('help:guide.supportedSubtitleFiles20'),
            where: t('help:guide.besideCCAfterCaptionsAreEnabled'),
            what: t('help:guide.forMovieMkvOrMovieMp4PlaceMovieSrt'),
          },
          {
            label: t('help:guide.plainTextOnly'),
            name: t('help:guide.subtitleStylingAndCaching'),
            where: t('help:guide.videoCaptions'),
            what: t('help:guide.stylizedSubtitlesAreNotSupportedAuthorFontsColorsBold'),
          },
          {
            icons: [Play, Pause],
            name: t('help:guide.playPause'),
            where: t('help:guide.leftOfTheVideoControlBar'),
            what: t('help:guide.startsOrPausesTheVideo'),
          },
          {
            label: t('help:guide.seek'),
            name: t('help:guide.seekBar'),
            where: t('help:guide.videoControlBar'),
            what: t('help:guide.dragOrTapToJumpToATimeThe'),
          },
          {
            icons: [Volume2, VolumeX],
            name: t('help:guide.muteUnmute'),
            where: t('help:guide.videoControlBar'),
            what: t('help:guide.silencesTheVideoOrRestoresItsVolume'),
          },
          {
            label: t('help:guide.volume'),
            name: t('help:guide.volumeSlider'),
            where: t('help:guide.videoControlBar'),
            what: t('help:guide.setsTheVolumeInFineSteps'),
          },
          {
            icons: [ListVideo],
            name: t('help:guide.autoplayNextVideo'),
            where: t('help:guide.videoControlBarIncludingFullscreen'),
            what: t('help:guide.whenOnTheNextVideoStartsByItselfWhen'),
          },
          {
            label: '1×',
            name: t('help:guide.playbackSpeed'),
            where: t('help:guide.videoControlBarViewOptionsOnUprightPhones'),
            what: t('help:guide.cycles1152And05'),
          },
          {
            icons: [PictureInPicture2],
            name: t('help:guide.pictureInPicture'),
            where: t('help:guide.videoControlBarViewOptionsOnUprightPhonesWhere'),
            what: t('help:guide.popsTheVideoIntoASmallFloatingWindow'),
          },
          {
            label: t('help:guide.resumeFrom123'),
            name: t('help:guide.resumeFromStartFromBeginning'),
            where: t('help:guide.overAVideoYouLeftPartWayThrough'),
            what: t('help:guide.carriesOnFromWhereYouStoppedOrStartsAgain'),
          },
        ],
      },
      {
        title: t('help:guide.metadataForOneItem'),
        entries: [
          {
            label: t('help:guide.importMetadataTags'),
            name: t('help:guide.importMetadataTags'),
            where: t('help:guide.mediaDetailsAndMediaInformationInFlick'),
            what: t('help:guide.readsThisFileSEmbeddedEXIFXMPTagsInto'),
          },
          {
            label: t('help:guide.exportXMP'),
            name: t('help:guide.exportXMP'),
            where: t('help:guide.mediaDetailsAndMediaInformationInFlick'),
            what: t('help:guide.preparesADownloadOfThisItemSTagsAs'),
          },
        ],
      },
      {
        title: t('help:guide.thumbnailIndicators'),
        entries: [
          {
            icons: [Film],
            name: t('help:guide.videoBadge'),
            where: t('help:guide.cornerOfAVideoThumbnail'),
            what: t('help:guide.marksAVideoGIFsShowAGIFBadgeInstead'),
          },
          {
            progressBar: true,
            name: t('help:guide.watchProgressBar'),
            where: t('help:guide.alongTheBottomOfAVideoThumbnail'),
            what: t('help:guide.noBarMeansUnwatchedAPartialBarMeansIn'),
          },
          {
            icons: [Heart],
            name: t('help:guide.liked'),
            where: t('help:guide.topCornerOfAThumbnail'),
            what: t('help:guide.theItemIsOneOfYourFavourites'),
          },
        ],
      },
    ],
    notes: [
      t('help:guide.watchProgressIsSavedOnThisLumaServerSo'),
      t('help:guide.resumeAppearsInTheNormalViewerOnlyFlickAlways'),
    ],
  },
  {
    id: 'reels',
    title: t('help:guide.flick'),
    summary: t('help:guide.fullScreenVerticalBrowsingOfVideosAndGIFs'),
    groups: [
      {
        title: t('help:guide.flickControls'),
        entries: [
          {
            icons: [Clapperboard],
            name: t('help:guide.flick'),
            where: t('help:guide.topLeftLumaLogoFlick'),
            what: t('help:guide.opensFlickWithItsOwnSavedFiltersSwitchingApplications'),
          },
          {
            icons: [EllipsisVertical, X],
            name: t('help:guide.flickMenu'),
            where: t('help:guide.bottomRightBesideLikeAndDislike'),
            what: t('help:guide.opensOrClosesTheFlickActions'),
          },
          {
            icons: [SlidersHorizontal],
            name: t('help:guide.filters'),
            where: t('help:guide.flickHeaderBesideSearch'),
            what: t('help:guide.opensFiltersAndSortingForFlickTheHeaderSearch'),
          },
          {
            icons: [EyeOff, Eye],
            name: t('help:guide.hideFiltersShowFilters'),
            where: t('help:guide.flickMenu'),
            what: t('help:guide.hidesOrShowsTheActiveFilterRowWithoutClearing'),
          },
          {
            icons: [VolumeX, Volume2],
            name: t('help:guide.muteUnmute'),
            where: t('help:guide.flickMenu'),
            what: t('help:guide.flickStartMutedYourChoiceIsRememberedOnThis'),
          },
          {
            icons: [Timer],
            name: t('help:guide.autoScroll'),
            where: t('help:guide.flickMenu'),
            what: t('help:guide.whenOnMovesToTheNextReelWhenA'),
          },
          {
            icons: [Tag],
            name: t('help:guide.tags'),
            where: t('help:guide.flickMenu'),
            what: t('help:guide.addsOrRemovesTagsOnTheCurrentReel'),
          },
          {
            icons: [Settings2],
            name: t('help:guide.viewOptions'),
            where: t('help:guide.flickMenu'),
            what: t('help:guide.fitOrFillOpenInViewerVolumeSliderPlayback'),
          },
          {
            icons: [Info],
            name: t('help:guide.mediaInformation'),
            where: t('help:guide.flickMenu'),
            what: t('help:guide.fileInformationPlusMetadataImportAndXMPExportFor'),
          },
          {
            icons: [ChevronUp, ChevronDown],
            name: t('help:guide.previousNext'),
            where: t('help:guide.flickMenu'),
            what: t('help:guide.movesToThePreviousOrNextReel'),
          },
          {
            icons: [Play],
            name: t('help:guide.playVideo'),
            where: t('help:guide.centreOfAPausedReel'),
            what: t('help:guide.resumesPlayback'),
          },
          {
            label: t('help:guide.openInViewer'),
            name: t('help:guide.openInViewer'),
            where: t('help:guide.viewOptionsInFlick'),
            what: t('help:guide.opensTheCurrentReelInTheNormalViewerWith'),
          },
          {
            label: t('help:guide.seekVideo'),
            name: t('help:guide.seekBar'),
            where: t('help:guide.tapTheBottomStripOfAVideoReel'),
            what: t('help:guide.revealsTheSeekBarForAFewSecondsThe'),
          },
        ],
      },
    ],
    notes: [
      t('help:guide.watchOnFlickInTheViewerStartsAtThe'),
      t('help:guide.flickHasAVolumeSliderInViewOptionsBut'),
      t('help:guide.flickRemembersWhereYouWereForTheSameSet'),
    ],
  },
  {
    id: 'tasks',
    title: t('help:guide.backgroundJobs'),
    summary: t('help:guide.scansMetadataImportsAndExports'),
    groups: [
      {
        title: t('help:guide.whereToFindTheQueue'),
        entries: [
          {
            icons: [RefreshCw],
            name: t('help:guide.backgroundJobs'),
            where: t('help:guide.topRightHeaderInGalleryAndPanels'),
            what: t('help:guide.opensTheJobsListStartARescanFromA'),
          },
        ],
      },
      {
        title: t('help:guide.queueActions'),
        entries: [
          {
            label: t('help:guide.cancel'),
            name: t('help:guide.cancelCancelScan'),
            where: t('help:guide.onAQueuedOrRunningTask'),
            what: t('help:guide.stopsTheTaskWorkAlreadyFinishedSuchAsPrepared'),
          },
          {
            label: t('help:guide.queueAgain'),
            name: t('help:guide.queueAgain'),
            where: t('help:guide.onACancelledFailedOrInterruptedTask'),
            what: t('help:guide.runsTheTaskAgainAsANewTaskWhich'),
          },
          {
            label: t('help:guide.clear'),
            name: t('help:guide.clear'),
            where: t('help:guide.onAnyTaskThatIsNoLongerActive'),
            what: t('help:guide.removesThatOneEntryFromTheList'),
          },
          {
            label: t('help:guide.clearFinished'),
            name: t('help:guide.clearFinished'),
            where: t('help:guide.topOfTheQueue'),
            what: t('help:guide.removesEveryCompletedCancelledFailedAndInterruptedEntryAnd'),
          },
        ],
      },
    ],
    notes: [
      t('help:guide.eachTaskShowsWhatItIsIndexingTagImport'),
      t('help:guide.interruptedMeansLumaStoppedTheTaskForExampleOn'),
      t('help:guide.clearFinishedOnlyTidiesTheListItDoesNot'),
      t('help:guide.finishedJobsClearThemselvesOnceThereAreMoreThan'),
      t('help:guide.cancellingStopsFurtherWorkItDoesNotUndoChanges'),
    ],
  },
  {
    id: 'settings',
    title: t('help:guide.settings'),
    summary: t('help:guide.updatesThemeAlbumCoversRandomMediaLinksExportsLibrary'),
    groups: [
      {
        title: t('help:guide.settingsSections'),
        entries: [
          {
            label: t('help:guide.fileManagementCheckMediaMounts'),
            name: t('help:guide.writableMediaMounts20'),
            where: t('help:guide.settingsFileManagement'),
            what: t('help:guide.useEnableFileManagementInSettingsGeneralNoAdministrator'),
          },
          {
            icons: [Settings],
            name: t('help:guide.settings'),
            where: t('help:guide.gearButtonInTheTopHeader'),
            what: t('help:guide.opensSettingsYourCurrentFiltersStayInPlaceFor'),
          },
          {
            icons: [CircleFadingArrowUp],
            name: t('help:guide.updates'),
            where: t('help:guide.topOfSettings'),
            what: t('help:guide.showsTheReleaseThisDeviceIsRunningWhenThe'),
          },
          {
            icons: [Sparkles],
            name: t('help:guide.whatSNew'),
            where: t('help:guide.settingsUpdates'),
            what: t('help:guide.listsWhatChangedInThisReleaseItOpensBy'),
          },
          {
            label: t('help:guide.themeAppearance'),
            name: t('help:guide.themeAppearance'),
            where: t('help:guide.settings'),
            what: t('help:guide.choosesLumaSColoursOnThisDevice'),
          },
          {
            label: t('help:guide.albumCovers'),
            name: t('help:guide.albumCovers'),
            where: t('help:guide.settings'),
            what: t('help:guide.smartCoversShowAMosaicForAlbumsWithThree'),
          },
          {
            label: t('help:guide.flick'),
            name: t('help:guide.flickDefaultOrder'),
            where: t('help:guide.settings'),
            what: t('help:guide.choosesTheOrderFlickOpensInOnThisDevice'),
          },
          {
            icons: [Shuffle],
            name: t('help:guide.randomMediaURL'),
            where: t('help:guide.settings'),
            what: t('help:guide.buildsAReusableLinkThatReturnsARandomCached'),
          },
          {
            label: t('help:guide.exportXMP'),
            name: t('help:guide.exportXMPExportDislikedPaths'),
            where: t('help:guide.settingsMetadataExchange'),
            what: t('help:guide.preparesDownloadsOfYourTagsAsXMPOrA'),
          },
          {
            label: t('help:guide.libraries'),
            name: t('help:guide.automaticDiscoveryAndTagImport'),
            where: t('help:guide.settingsLibraries'),
            what: t('help:guide.choosesWatcherPeriodicScanOrManualDiscoveryPerLibrary'),
          },
          {
            icons: [Eye],
            name: t('help:guide.show'),
            where: t('help:guide.settingsHiddenFolders'),
            what: t('help:guide.bringsAHiddenFolderBackIntoBrowsingAndIndexing'),
          },
          {
            icons: [CircleHelp],
            name: t('help:guide.help'),
            where: t('help:guide.settingsAndBesideYourLibraries'),
            what: t('help:guide.opensThisGuide'),
          },
          {
            label: t('help:guide.about'),
            name: t('help:guide.about'),
            where: t('help:guide.endOfSettings'),
            what: t('help:guide.showsTheInstalledLumaVersionProjectLinkAndCreator'),
          },
        ],
      },
    ],
    notes: [t('help:guide.metadataImportsAreStartedFromAFolderFolderActions')],
  },
]

export type Gesture = { gesture: string; where: string; result: string }

export const gestures: Gesture[] = [
  {
    gesture: t('help:guide.swipeLeftOrRight'),
    where: t('help:guide.viewer'),
    result: t('help:guide.nextOrPreviousItem'),
  },
  {
    gesture: t('help:guide.pinch'),
    where: t('help:guide.photosInTheViewer'),
    result: t('help:guide.zoomsInOrOutDragToPanWhileZoomed'),
  },
  {
    gesture: t('help:guide.doubleTap'),
    where: t('help:guide.photosAndGIFsInTheViewer'),
    result: t('help:guide.zoomsIntoTheTappedSpotDoubleTapAgainTo'),
  },
  {
    gesture: t('help:guide.mouseWheel'),
    where: t('help:guide.photosInTheViewer'),
    result: t('help:guide.zoomsInOrOut'),
  },
  {
    gesture: t('help:guide.tap'),
    where: t('help:guide.videos'),
    result: t('help:guide.playsOrPausesInFullscreenWithHiddenControlsThe'),
  },
  {
    gesture: t('help:guide.doubleTapLeftOrRightThird'),
    where: t('help:guide.videosInTheViewerAndFlick'),
    result: t('help:guide.skipsBackOrForward10Seconds'),
  },
  {
    gesture: t('help:guide.pressAndHold'),
    where: t('help:guide.playingVideos'),
    result: t('help:guide.playsAt2UntilYouLetGo'),
  },
  {
    gesture: t('help:guide.swipeUpOrDownOnTheRightSide'),
    where: t('help:guide.videosInTheNormalViewerOnly'),
    result: t('help:guide.raisesOrLowersTheVolumeWithABriefVolume'),
  },
  {
    gesture: t('help:guide.pullDownFromTheTop'),
    where: t('help:guide.gallery'),
    result: t('help:guide.checksTheFolderInViewForNewChangedAnd'),
  },
  {
    gesture: t('help:guide.swipeUpOrDown'),
    where: t('help:guide.flick'),
    result: t('help:guide.nextOrPreviousReelMouseWheelAndTrackpadScrolling'),
  },
  {
    gesture: t('help:guide.doubleTapTripleTapTheCentre'),
    where: t('help:guide.flickVideosPhotosAndGIFs'),
    result: t('help:guide.likesDislikesTheReel'),
  },
  {
    gesture: t('help:guide.tapTheBottomStrip'),
    where: t('help:guide.videoReels'),
    result: t('help:guide.revealsTheSeekBar'),
  },
  {
    gesture: t('help:guide.pressAndHoldATag'),
    where: t('help:guide.collectionsTags'),
    result: t('help:guide.opensManageTag'),
  },
]

export type Shortcut = { keys: string[]; result: string }
export type ShortcutGroup = { title: string; shortcuts: Shortcut[] }

export const shortcutGroups: ShortcutGroup[] = [
  {
    title: t('help:guide.viewer'),
    shortcuts: [
      { keys: ['←', '→'], result: t('help:guide.previousOrNextItem') },
      { keys: ['I'], result: t('help:guide.openMediaDetails') },
      { keys: ['T'], result: t('help:guide.openMediaDetailsWithTheTagFieldReady') },
      { keys: ['S'], result: t('help:guide.startOrPauseTheSlideshow') },
      { keys: ['+', '−'], result: t('help:guide.zoomAPhotoInOrOut') },
      { keys: ['1'], result: t('help:guide.actualSize') },
      { keys: ['R'], result: t('help:guide.rotateAPhoto90') },
      { keys: ['F'], result: t('help:guide.enterOrLeaveFullscreen') },
      { keys: ['Esc'], result: t('help:guide.closeTheTopPanelThenTheViewer') },
    ],
  },
  {
    title: t('help:guide.videos'),
    shortcuts: [
      { keys: ['Space', 'K'], result: t('help:guide.playOrPause') },
      { keys: ['J', 'L'], result: t('help:guide.backOrForward10Seconds') },
      { keys: ['M'], result: t('help:guide.muteOrUnmuteNormalViewerOnly') },
    ],
  },
  {
    title: t('help:guide.flick'),
    shortcuts: [
      { keys: ['↑', '↓'], result: t('help:guide.previousOrNextReel') },
      { keys: ['←', '→'], result: t('help:guide.backOrForward5SecondsInAVideo') },
      { keys: ['Space', 'K'], result: t('help:guide.playOrPause') },
      { keys: ['J', 'L'], result: t('help:guide.backOrForward10Seconds') },
      { keys: ['F'], result: t('help:guide.enterOrLeaveFullscreen') },
    ],
  },
]
