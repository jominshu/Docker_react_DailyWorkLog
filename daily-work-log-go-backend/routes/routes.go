package routes

import (
	"Daily_Work_Log/daily-work-log-go-backend/handlers"
	"Daily_Work_Log/daily-work-log-go-backend/middlewares"

	"github.com/gin-gonic/gin"
)

func SetupRoutes(router *gin.Engine) {
	api := router.Group("/api")
	{
		// 測試路由
		api.GET("/test", func(c *gin.Context) {
			c.JSON(200, gin.H{
				"message": "後端伺服器運行中",
			})
		})

		// 登入取得 JWT
		api.POST("/auth/login", handlers.Login)
		api.POST("/auth/refresh", handlers.RefreshToken)
		api.POST("/auth/logout", handlers.Logout)

		// 公司列表（無需登入）
		api.GET("/companies", handlers.GetCompanies)

		// 需身份驗證的工時記錄
		auth := api.Group("/")
		auth.Use(middlewares.AuthMiddleware())
		{
			auth.POST("/work-hours", handlers.CreateWorkHours)
			auth.GET("/work-hours/:empno", handlers.GetWorkHoursByEmpNo)
			auth.PUT("/work-hours/:id", handlers.UpdateWorkHours) // 編輯功能
			auth.DELETE("/work-hours/:id", handlers.DeleteWorkHours)
			auth.GET("/permissions/me", handlers.GetMyPermissions)
			auth.GET("/reports/monthly", handlers.GetMonthlyReport)
			auth.GET("/reports/support-hours-summary", handlers.GetSupportHoursSummary)
			auth.GET("/reports/support-hours-details", handlers.GetSupportHoursDetail)
			auth.GET("/reports/employee-work-hours-total", handlers.GetEmployeeWorkHoursTotal)
		}

		admin := auth.Group("/")
		admin.Use(middlewares.AdminOnly())
		{
			admin.GET("/admins", handlers.ListAdmins)
			admin.POST("/admins", handlers.AddAdmin)
			admin.PUT("/admins/:empno", handlers.UpdateAdmin)
			admin.DELETE("/admins/:empno", handlers.DeleteAdmin)
			admin.GET("/permissions", handlers.ListPermissions)
			admin.PUT("/permissions/:empno", handlers.UpdatePermission)
		}
	}
}
