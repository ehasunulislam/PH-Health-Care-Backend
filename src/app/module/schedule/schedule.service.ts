import { addDays, differenceInMinutes, isAfter, isSameDay, startOfDay } from "date-fns"
import { prisma } from "../../lib/prisma"
import { RequestUser } from "../../middleware/checkAuth"
import { AppError } from "../../utils/AppError"
import { ICreateSchedulePayload, IUpdateSchedulePayload } from "./schedule.interface"
import  HttpStatus  from "http-status"
import { IQuery } from "../../interfaces/global.interface"
import httpStatus from "http-status";
import { ScheduleWhereInput } from "../../../generated/prisma/models"
import { ScheduleStaus } from "../../../generated/prisma/enums"


// create a schedule for a doctor
const createSchedule = async(payload: ICreateSchedulePayload, user: RequestUser) => {
    const doctor = await prisma.doctor.findUnique({
        where: {
            userId: user.userId
        }
    });

    if(!doctor) {
        throw new AppError(HttpStatus.NOT_FOUND, "Doctor Profile Not Found")
    }

    const startOfTheDay = startOfDay(payload.startDateTime);
    const startOfNextDay = addDays(startOfTheDay, 1);

    const exsistingScheduleOnThisDate = await prisma.schedule.findFirst({
        where: {
            doctorId: doctor.id,
            isDeleted: false,
            startDateTime: {
                gte: startOfTheDay,
                lte:  startOfNextDay
            }
        }
    });


    if(exsistingScheduleOnThisDate) {
        throw new AppError(HttpStatus.CONFLICT, "You Already Have A Schedule For This Date")
    }

    const durationInMinutes = differenceInMinutes(
        payload.startDateTime,
        payload.endDateTime
    );

    const MINITUES_ALLOCATED_PER_SLOT = 20

    const totalSlots = Math.floor(durationInMinutes / MINITUES_ALLOCATED_PER_SLOT);

    const schedule = await prisma.schedule.create({
        data: {
            startDateTime: payload.startDateTime,
            endDateTime: payload.endDateTime,
            meetingLink: payload.meetingLink,
            totalSlots,
            availableSlot: totalSlots,
            doctorId: doctor.id
        },

        include: {
            doctor: {
                select: {
                    name: true,
                    email: true,
                    contactNumber: true
                }
            }
        }
    });

    return schedule
}

// get all schedule for seeing doctor
const getMySchedules = async (query : IQuery, user : RequestUser) => {

    const limit = query.limit ? Number(query.limit) : 10;
    const page = query.page ? Number(query.page) : 1;
    const skip = (page - 1) * limit;
    const sortBy = query.sortBy ? query.sortBy : "createdAt";
    const sortOrder = query.sortOrder ? query.sortOrder : "desc"

    const doctor = await prisma.doctor.findUnique({
        where: { userId: user.userId },
    });

    if (!doctor) {
        throw new AppError(httpStatus.NOT_FOUND, "Doctor Profile Not Found");
    }
    
    const andConditions: ScheduleWhereInput[] = [
        {
            doctorId : doctor.id
        },
        {
            isDeleted : false
        }
    ];

    if (query.status) {
        andConditions.push({ staus: query.status });
    }

    const schedules = await prisma.schedule.findMany({
        where : {
            AND : andConditions
        },

        take: limit,
        skip,
        orderBy: {
            // sortBy : sortOrder
            [sortBy]: sortOrder
        },
        include : {
            appointments : {
                include : {
                    patient : true
                }
            }
        }
    })

    const total = await prisma.schedule.count({ where: { AND: andConditions } });

    return {
        data: schedules,
        meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };

}

// get All schedul
const getAllSchedules = async (query : IQuery) => {

    const limit = query.limit ? Number(query.limit) : 10;
    const page = query.page ? Number(query.page) : 1;
    const skip = (page - 1) * limit;
    const sortBy = query.sortBy ? query.sortBy : "createdAt";
    const sortOrder = query.sortOrder ? query.sortOrder : "desc"

    const andConditions: ScheduleWhereInput[] = [];

    if (query.doctorId) {
        andConditions.push({ doctorId: query.doctorId });
    }

    if (query.email) {
        andConditions.push({ doctor : {
            email : query.email
        } });
    }

    if (query.status) {
        andConditions.push({ staus: query.status });
    }

    if (query.searchTerm) {
        andConditions.push({
            doctor: {
                OR: [
                    { name: { contains: query.searchTerm, mode: "insensitive" } },
                    { email: { contains: query.searchTerm, mode: "insensitive" } },
                    {
                        specialization: { contains: query.searchTerm, mode: "insensitive" },
                    },
                ],
            },
        });
    };

    const schedules = await prisma.schedule.findMany({
        where: {
            AND: andConditions
        },

        take: limit,
        skip,
        orderBy: {
            // sortBy : sortOrder
            [sortBy]: sortOrder
        },
        include: {
            appointments: {
                include: {
                    patient: true
                }
            }
        }
    })

    const total = await prisma.schedule.count({ where: { AND: andConditions } });

    return {
        data: schedules,
        meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };

}


// get schedule by id
const getScheduleById = async (scheduleId : string) => {

    const schedule = await prisma.schedule.findUnique({
        where: { id: scheduleId },
        include: {
            doctor: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                    specialization: true,
                    userId: true,
                },
            },
            appointments: {
                include: {
                    patient: true
                },
            }
        },
    });

    if(!schedule || schedule.isDeleted){
        throw new AppError(httpStatus.NOT_FOUND, "Schedule Not Found");
    }

    return schedule
}

// update schedule
const updateSchedule = async (scheduleId : string, payload : IUpdateSchedulePayload, user : RequestUser) => {

    const doctor = await prisma.doctor.findUnique({
        where: { userId: user.userId },
    });

    if (!doctor) {
        throw new AppError(httpStatus.NOT_FOUND, "Doctor Profile Not Found");
    }

    const schedule = await prisma.schedule.findUnique({
        where : { 
            id : scheduleId, 
            doctorId : doctor.id
        }
    })

    if (!schedule || schedule.isDeleted) {
        throw new AppError(httpStatus.NOT_FOUND, "Schedule Not Found");
    }

    if(schedule.staus === ScheduleStaus.PUBLISHED && schedule.totalSlots !== schedule.availableSlot){
        throw new AppError(httpStatus.CONFLICT, "Schedule Once Published And Appoinemtn Booked Cannot Be Updated");
    }

    // if (schedule.doctorId !== doctor.id) {
    //     throw new AppError(
    //         httpStatus.FORBIDDEN,
    //         "You Are Not Allowed To Update This Schedule",
    //     );
    // }


    // const updateData : IUpdateSchedulePayload = {};

    // if(payload.meetingLink){
    //     updateData.meetingLink = payload.meetingLink || schedule.meetingLink
    // }

    payload.meetingLink = payload.meetingLink || schedule.meetingLink
    payload.startDateTime = payload.startDateTime || schedule.startDateTime
    payload.endDateTime = payload.endDateTime || schedule.endDateTime


    // 25 August => start Time  : 9:00 PM 
    // 26 August => end Time : 3:00AM

    if (!isSameDay(payload.startDateTime, payload.endDateTime)) {
        throw new AppError(httpStatus.CONFLICT, "Start Date Time And End Date Time Must Be On The Same Day")
    }
    if (isAfter(payload.startDateTime, payload.endDateTime)) { // 25 August =>  3:00 PM - 9:00 PM

        throw new AppError(httpStatus.CONFLICT, "Start Date Time Cannot Be After End Date Time")
    }

    //startDateTime = 2026-08-25T13:30:00.436Z => 1:30 PM
    const startOfTheDay = startOfDay(payload.startDateTime) // 25 August => 12:00 AM => 2026-08-25T00:00:00.436Z
    const startOfNextDay = addDays(startOfTheDay, 1)  // 26 August => 12:00 AM => 2026-08-26T00:00:00.436Z

    const existingScheduleOnThisDate = await prisma.schedule.findFirst({
        where: {
            doctorId: doctor.id,
            isDeleted: false,
            startDateTime: {
                gte: startOfTheDay,
                lt: startOfNextDay
            }
        }
    })

    if (existingScheduleOnThisDate) {
        throw new AppError(
            httpStatus.CONFLICT,
            "You Already Have A Schedule For This Date",
        );
    }

    const durationInMinutes = differenceInMinutes(
        payload.endDateTime,
        payload.startDateTime
    )

    const MINUTES_ALLOCATED_PER_SLOT = 20

    const totalSlots = Math.floor(durationInMinutes / MINUTES_ALLOCATED_PER_SLOT)

    if (totalSlots < 1) {
        throw new AppError(
            httpStatus.CONFLICT,
            `Schedule Must Be At Least ${MINUTES_ALLOCATED_PER_SLOT} Minutes Long To Fit One Slot`,
        );
    }

    const updatedSchedule = await prisma.schedule.update({
        where : {
            id : schedule.id
        },
        data: {
            startDateTime: payload.startDateTime,
            endDateTime: payload.endDateTime,
            meetingLink: payload.meetingLink,
            totalSlots,
            availableSlots: totalSlots,
            doctorId: doctor.id
        },
        include: {
            doctor: {
                select: {
                    name: true,
                    email: true,
                    contactNumber: true
                }
            }
        }
    })

    return updatedSchedule
}


export const scheduleService = {
    createSchedule,
    getMySchedules,
    getAllSchedules,
    getScheduleById,
    updateSchedule
}